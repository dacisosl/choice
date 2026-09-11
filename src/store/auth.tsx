import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppConfig, Member } from '../types'
import { ensureFirebaseApp, getDb, hasFirebaseConfig, MEMBERS_COLLECTION } from './firebase'
import { loadConfig } from './storage'

export interface AuthUser {
  uid: string
  email: string
  photoURL?: string
  googleName?: string
  anonymous: boolean
}

export interface AuthContextValue {
  /** 설정을 다 읽고 로그인 상태가 확정된 뒤 true */
  ready: boolean
  /** Firebase 설정이 있어 로그인 방식을 쓰는지 */
  enabled: boolean
  config: AppConfig
  user: AuthUser | null
  member: Member | null
  error: string | null
  busy: boolean
  isApproved: boolean
  isAdmin: boolean
  /** 구글 로그인 없이 자동으로 만들어진 익명 세션인지 (일반 교사) */
  isAnonymous: boolean
  /** config의 ownerEmail과 같은 계정 — 승인 없이 관리자 */
  isOwner: boolean
  /** config에 설정된 최초 관리자 주소 (진단 표시용) */
  ownerEmail: string
  signIn: () => Promise<void>
  signOutUser: () => Promise<void>
  /** 최초 로그인 후 이름을 정해 가입 신청 */
  submitProfile: (displayName: string) => Promise<void>
  reloadMember: () => Promise<void>
  listMembers: () => Promise<Member[]>
  saveMember: (m: Member) => Promise<void>
  deleteMember: (uid: string) => Promise<void>
  /** 승인 대기 인원 수 (관리자만 집계) */
  pendingCount: number
  refreshPending: () => Promise<void>
}

const Ctx = createContext<AuthContextValue | null>(null)

type Fs = typeof import('firebase/firestore')

/**
 * 최초 관리자(ownerEmail) 계정이면 명단 문서를 승인·관리자 상태로 맞춘다.
 * 규칙에서 isOwner()는 update 를 허용하므로 콘솔 작업 없이 스스로 승격된다.
 */
async function promoteOwnerIfNeeded(
  fs: Fs,
  db: import('firebase/firestore').Firestore,
  email: string,
  ownerEmail: string | undefined,
  m: Member | null,
): Promise<Member | null> {
  if (!m || !ownerEmail) return m
  if (email.toLowerCase() !== ownerEmail.trim().toLowerCase()) return m
  if (m.status === 'approved' && m.role === 'admin') return m
  const next: Member = { ...m, status: 'approved', role: 'admin', decidedAt: new Date().toISOString() }
  try {
    await fs.setDoc(fs.doc(db, MEMBERS_COLLECTION, m.uid), JSON.parse(JSON.stringify(next)))
    return next
  } catch (e) {
    console.warn('최초 관리자 자동 승격 실패', e)
    return m
  }
}

/** 구글 로그인 오류 코드를 사람이 읽는 문장으로 */
function authErrorText(e: unknown): string {
  const code = (e as { code?: string }).code || ''
  if (code.includes('operation-not-allowed'))
    return '이 프로젝트에서 구글 로그인이 아직 켜져 있지 않습니다. Firebase 콘솔의 Authentication에서 Google 공급업체를 사용 설정하세요.'
  if (code.includes('unauthorized-domain'))
    return '이 주소가 Firebase에 등록되어 있지 않습니다. Authentication › 설정 › 승인된 도메인에 현재 도메인을 추가하세요.'
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return '로그인 창이 닫혔습니다. 다시 시도하세요.'
  if (code.includes('network-request-failed')) return '네트워크 오류로 로그인하지 못했습니다.'
  return (e as Error).message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [config, setConfig] = useState<AppConfig>({})
  const [user, setUser] = useState<AuthUser | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const fsRef = useRef<{ fs: Fs; db: import('firebase/firestore').Firestore } | null>(null)

  const getFs = useCallback(async () => {
    if (fsRef.current) return fsRef.current
    const cfg = config.firebase
    if (!hasFirebaseConfig(cfg)) throw new Error('Firebase 설정이 없습니다.')
    const [app, fs] = await Promise.all([ensureFirebaseApp(cfg), import('firebase/firestore')])
    fsRef.current = { fs, db: getDb(fs, app, cfg) }
    return fsRef.current
  }, [config])

  const fetchMember = useCallback(
    async (uid: string): Promise<Member | null> => {
      const { fs, db } = await getFs()
      const snap = await fs.getDoc(fs.doc(db, MEMBERS_COLLECTION, uid))
      return snap.exists() ? (snap.data() as Member) : null
    },
    [getFs],
  )

  useEffect(() => {
    let cancelled = false
    let unsub: (() => void) | undefined
    ;(async () => {
      const cfg = await loadConfig()
      if (cancelled) return
      setConfig(cfg)
      if (!hasFirebaseConfig(cfg.firebase)) {
        setEnabled(false)
        setReady(true)
        return
      }
      setEnabled(true)
      try {
        const [app, auth, fs] = await Promise.all([
          ensureFirebaseApp(cfg.firebase),
          import('firebase/auth'),
          import('firebase/firestore'),
        ])
        const db = getDb(fs, app, cfg.firebase)
        fsRef.current = { fs, db }
        const a = auth.getAuth(app)
        unsub = auth.onAuthStateChanged(a, async (u) => {
          if (cancelled) return
          if (!u) {
            // 일반 교사는 로그인 없이 제출할 수 있도록 익명 세션을 자동으로 만든다
            setUser(null)
            setMember(null)
            try {
              await auth.signInAnonymously(a)
            } catch (e) {
              console.warn('익명 세션 생성 실패', e)
              setReady(true)
            }
            return
          }
          setUser({
            uid: u.uid,
            email: u.email || '',
            photoURL: u.photoURL || undefined,
            googleName: u.displayName || undefined,
            anonymous: u.isAnonymous,
          })
          if (u.isAnonymous) {
            setMember(null)
            setError(null)
            setReady(true)
            return
          }
          try {
            const snap = await fs.getDoc(fs.doc(db, MEMBERS_COLLECTION, u.uid))
            if (cancelled) return
            const m0 = snap.exists() ? (snap.data() as Member) : null
            setMember(await promoteOwnerIfNeeded(fs, db, u.email || '', cfg.firebase?.ownerEmail, m0))
            setError(null)
          } catch (e) {
            setMember(null)
            setError(`구성원 정보를 읽지 못했습니다: ${(e as Error).message}`)
          }
          setReady(true)
        })
      } catch (e) {
        setError(`로그인 초기화 실패: ${(e as Error).message}`)
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
      unsub?.()
    }
    // 최초 1회만 실행한다. config 상태를 의존성에 넣으면 재실행 루프가 생긴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signIn = useCallback(async () => {
    if (!hasFirebaseConfig(config.firebase)) return
    setBusy(true)
    setError(null)
    try {
      const [app, auth] = await Promise.all([ensureFirebaseApp(config.firebase), import('firebase/auth')])
      const a = auth.getAuth(app)
      const provider = new auth.GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      const current = a.currentUser
      try {
        // 익명으로 작성 중이던 문서를 잃지 않도록 계정을 연결한다
        if (current?.isAnonymous) {
          try {
            await auth.linkWithPopup(current, provider)
          } catch (e) {
            const code = (e as { code?: string }).code || ''
            if (code.includes('already-in-use') || code.includes('provider-already-linked')) await auth.signInWithPopup(a, provider)
            else throw e
          }
        } else {
          await auth.signInWithPopup(a, provider)
        }
      } catch (e) {
        const code = (e as { code?: string }).code || ''
        if (code.includes('popup-blocked') || code.includes('operation-not-supported')) {
          await auth.signInWithRedirect(a, provider)
        } else throw e
      }
    } catch (e) {
      setError(authErrorText(e))
    } finally {
      setBusy(false)
    }
  }, [config])

  const signOutUser = useCallback(async () => {
    if (!hasFirebaseConfig(config.firebase)) return
    const [app, auth] = await Promise.all([ensureFirebaseApp(config.firebase), import('firebase/auth')])
    await auth.signOut(auth.getAuth(app))
    setUser(null)
    setMember(null)
    // 로그아웃해도 일반 교사 기능은 계속 쓸 수 있도록 익명 세션을 다시 만든다
    try {
      await auth.signInAnonymously(auth.getAuth(app))
    } catch {
      /* 다음 새로고침에서 재시도 */
    }
  }, [config])

  const submitProfile = useCallback(
    async (displayName: string) => {
      if (!user) return
      setBusy(true)
      setError(null)
      try {
        const { fs, db } = await getFs()
        const next: Member = {
          uid: user.uid,
          email: user.email,
          displayName: displayName.trim(),
          role: 'member',
          status: 'pending',
          requestedAt: new Date().toISOString(),
        }
        await fs.setDoc(fs.doc(db, MEMBERS_COLLECTION, user.uid), next)
        setMember(await promoteOwnerIfNeeded(fs, db, user.email, config.firebase?.ownerEmail, await fetchMember(user.uid)))
      } catch (e) {
        setError(`가입 신청 실패: ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    },
    [user, getFs, fetchMember, config],
  )

  const reloadMember = useCallback(async () => {
    if (!user) return
    setBusy(true)
    try {
      setMember(await fetchMember(user.uid))
      setError(null)
    } catch (e) {
      setError(`새로고침 실패: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [user, fetchMember])

  const listMembers = useCallback(async (): Promise<Member[]> => {
    const { fs, db } = await getFs()
    const snap = await fs.getDocs(fs.collection(db, MEMBERS_COLLECTION))
    return snap.docs.map((d) => d.data() as Member).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
  }, [getFs])

  const listMembersRef = useRef<(() => Promise<Member[]>) | null>(null)
  listMembersRef.current = listMembers

  const refreshPending = useCallback(async () => {
    try {
      const list = await (listMembersRef.current?.() ?? Promise.resolve([]))
      setPendingCount(list.filter((m) => m.status === 'pending').length)
    } catch {
      /* 권한이 없으면 집계하지 않는다 */
    }
  }, [])

  const saveMember = useCallback(
    async (m: Member) => {
      const { fs, db } = await getFs()
      await fs.setDoc(fs.doc(db, MEMBERS_COLLECTION, m.uid), JSON.parse(JSON.stringify(m)))
      if (user && m.uid === user.uid) setMember(m)
      refreshPending()
    },
    [getFs, user, refreshPending],
  )

  const deleteMember = useCallback(
    async (uid: string) => {
      const { fs, db } = await getFs()
      await fs.deleteDoc(fs.doc(db, MEMBERS_COLLECTION, uid))
      refreshPending()
    },
    [getFs, refreshPending],
  )

  const ownerEmail = (config.firebase?.ownerEmail || '').trim().toLowerCase()
  const isOwner = !!(enabled && !user?.anonymous && ownerEmail && user?.email && user.email.toLowerCase() === ownerEmail)
  const isAnonymous = !!user?.anonymous
  const adminNow = !!(enabled && !isAnonymous && (isOwner || (member?.status === 'approved' && member.role === 'admin')))

  // 관리자면 승인 대기 인원을 집계하고 1분마다 갱신한다
  useEffect(() => {
    if (!adminNow) {
      setPendingCount(0)
      return
    }
    refreshPending()
    const t = window.setInterval(refreshPending, 60000)
    return () => window.clearInterval(t)
  }, [adminNow, refreshPending])

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      enabled,
      config,
      user,
      member,
      error,
      busy,
      isApproved: !enabled || (!isAnonymous && (isOwner || member?.status === 'approved')),
      isAdmin: !enabled || adminNow,
      isOwner,
      isAnonymous,
      ownerEmail,
      signIn,
      signOutUser,
      submitProfile,
      reloadMember,
      listMembers,
      saveMember,
      deleteMember,
      pendingCount,
      refreshPending,
    }),
    [ready, enabled, config, user, member, error, busy, isOwner, isAnonymous, adminNow, ownerEmail, signIn, signOutUser, submitProfile, reloadMember, listMembers, saveMember, deleteMember, pendingCount, refreshPending],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('AuthProvider missing')
  return v
}
