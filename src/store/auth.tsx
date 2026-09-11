import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppConfig, Member } from '../types'
import { ensureFirebaseApp, hasFirebaseConfig, MEMBERS_COLLECTION } from './firebase'
import { loadConfig } from './storage'

export interface AuthUser {
  uid: string
  email: string
  photoURL?: string
  googleName?: string
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
  /** config의 ownerEmail과 같은 계정 — 승인 없이 관리자 */
  isOwner: boolean
  /** 로그인을 건너뛴 예비 모드 */
  localOnly: boolean
  enterLocalOnly: () => void
  exitLocalOnly: () => void
  signIn: () => Promise<void>
  signOutUser: () => Promise<void>
  /** 최초 로그인 후 이름을 정해 가입 신청 */
  submitProfile: (displayName: string) => Promise<void>
  reloadMember: () => Promise<void>
  listMembers: () => Promise<Member[]>
  saveMember: (m: Member) => Promise<void>
  deleteMember: (uid: string) => Promise<void>
}

const Ctx = createContext<AuthContextValue | null>(null)

type Fs = typeof import('firebase/firestore')

/** 로그인을 건너뛰고 이 브라우저에만 저장하는 예비 모드 (Firebase 설정 전·장애 시) */
const LOCAL_ONLY_KEY = 'choice.localOnly'
function readLocalOnly(): boolean {
  try {
    return localStorage.getItem(LOCAL_ONLY_KEY) === '1'
  } catch {
    return false
  }
}
function writeLocalOnly(v: boolean): void {
  try {
    if (v) localStorage.setItem(LOCAL_ONLY_KEY, '1')
    else localStorage.removeItem(LOCAL_ONLY_KEY)
  } catch {
    /* ignore */
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
  const [localOnly, setLocalOnly] = useState(readLocalOnly)
  const fsRef = useRef<{ fs: Fs; db: import('firebase/firestore').Firestore } | null>(null)

  const getFs = useCallback(async () => {
    if (fsRef.current) return fsRef.current
    const cfg = config.firebase
    if (!hasFirebaseConfig(cfg)) throw new Error('Firebase 설정이 없습니다.')
    const [app, fs] = await Promise.all([ensureFirebaseApp(cfg), import('firebase/firestore')])
    fsRef.current = { fs, db: fs.getFirestore(app) }
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
      if (!hasFirebaseConfig(cfg.firebase) || readLocalOnly()) {
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
        const db = fs.getFirestore(app)
        fsRef.current = { fs, db }
        unsub = auth.onAuthStateChanged(auth.getAuth(app), async (u) => {
          if (cancelled) return
          if (!u) {
            setUser(null)
            setMember(null)
            setReady(true)
            return
          }
          setUser({
            uid: u.uid,
            email: u.email || '',
            photoURL: u.photoURL || undefined,
            googleName: u.displayName || undefined,
          })
          try {
            const snap = await fs.getDoc(fs.doc(db, MEMBERS_COLLECTION, u.uid))
            if (cancelled) return
            setMember(snap.exists() ? (snap.data() as Member) : null)
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
      try {
        await auth.signInWithPopup(a, provider)
      } catch (e) {
        const code = (e as { code?: string }).code || ''
        if (code.includes('popup-blocked') || code.includes('operation-not-supported') || code.includes('popup-closed-by-user')) {
          if (code.includes('popup-closed-by-user')) throw e
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
        setMember(await fetchMember(user.uid))
      } catch (e) {
        setError(`가입 신청 실패: ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    },
    [user, getFs, fetchMember],
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

  const saveMember = useCallback(
    async (m: Member) => {
      const { fs, db } = await getFs()
      await fs.setDoc(fs.doc(db, MEMBERS_COLLECTION, m.uid), JSON.parse(JSON.stringify(m)))
      if (user && m.uid === user.uid) setMember(m)
    },
    [getFs, user],
  )

  const deleteMember = useCallback(
    async (uid: string) => {
      const { fs, db } = await getFs()
      await fs.deleteDoc(fs.doc(db, MEMBERS_COLLECTION, uid))
    },
    [getFs],
  )

  const ownerEmail = (config.firebase?.ownerEmail || '').trim().toLowerCase()
  const isOwner = !!(enabled && ownerEmail && user?.email && user.email.toLowerCase() === ownerEmail)

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      enabled,
      config,
      user,
      member,
      error,
      busy,
      isApproved: !enabled || isOwner || member?.status === 'approved',
      isAdmin: !enabled || isOwner || (member?.status === 'approved' && member.role === 'admin'),
      isOwner,
      localOnly,
      enterLocalOnly: () => {
        writeLocalOnly(true)
        setLocalOnly(true)
        setEnabled(false)
      },
      exitLocalOnly: () => {
        writeLocalOnly(false)
        setLocalOnly(false)
        location.reload()
      },
      signIn,
      signOutUser,
      submitProfile,
      reloadMember,
      listMembers,
      saveMember,
      deleteMember,
    }),
    [ready, enabled, config, user, member, error, busy, localOnly, isOwner, signIn, signOutUser, submitProfile, reloadMember, listMembers, saveMember, deleteMember],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('AuthProvider missing')
  return v
}
