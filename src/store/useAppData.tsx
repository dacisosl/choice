import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppConfig, Evaluation, Master, Summary } from '../types'
import { seedMaster } from '../seed'
import { loadConfig, loadEvaluations, loadMaster, loadSummaries, lsGet, lsSet, saveEvaluations, saveMasterLocal, saveSummaries } from './storage'
import { migrateEvaluation, migrateMaster, migrateSummary } from './migrate'
import {
  authErrorText,
  changePassword as fbChangePassword,
  createSchool,
  deleteAccount as fbDeleteAccount,
  fetchSchool,
  hasFirebaseConfig,
  normalizeSchoolId,
  renameSchool,
  saveSchoolData,
  schoolIdError,
  sendReset as fbSendReset,
  isSuperAdmin as isSuperAdminEmail,
  signIn as fbSignIn,
  signInWithGoogle,
  signOutAccount,
  signUp as fbSignUp,
  subscribeSchool,
  watchAccount,
  type AccountUser,
  type SchoolDoc,
} from './school'

const SCHOOL_ID_KEY = 'choice.schoolId'

/** off = Firebase 설정 없음, none = 아직 학교 아이디를 넣지 않음, ok = 연결됨, missing = 그런 아이디 없음 */
export type SchoolStatus = 'off' | 'none' | 'loading' | 'ok' | 'missing' | 'error'

export interface AppData {
  ready: boolean
  config: AppConfig
  master: Master
  evaluations: Evaluation[]
  summaries: Summary[]

  /** 학교 공유(과목·출판사) 상태 */
  schoolStatus: SchoolStatus
  schoolId: string | null
  school: SchoolDoc | null
  schoolError: string | null
  /** Firebase 설정이 있어 학교 계정 기능을 쓸 수 있는지 */
  accountEnabled: boolean
  user: AccountUser | null
  /** 지금 연결된 학교의 담당자 계정으로 로그인했는지 */
  isOwner: boolean
  busy: boolean
  authError: string | null

  attachSchool: (id: string) => Promise<boolean>
  detachSchool: () => void
  signUp: (v: { email: string; password: string; schoolId: string; schoolName: string }) => Promise<boolean>
  /** 담당자가 학교 아이디를 다른 값으로 옮긴다 (교사들은 새 아이디를 다시 입력해야 한다) */
  changeSchoolId: (id: string) => Promise<boolean>
  /** 운영자(최종 관리자) 구글 로그인 */
  signInGoogle: () => Promise<boolean>
  isSuperAdmin: boolean
  signIn: (email: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
  sendReset: (email: string) => Promise<boolean>
  changePassword: (current: string, next: string) => Promise<boolean>
  deleteAccount: (current: string) => Promise<boolean>
  clearAuthError: () => void

  saveMaster: (m: Master) => Promise<void>
  saveEvaluation: (e: Evaluation) => Promise<void>
  deleteEvaluation: (id: string) => Promise<void>
  saveSummary: (s: Summary) => Promise<void>
  deleteSummary: (id: string) => Promise<void>
  resetMaster: () => Promise<void>
}

const Ctx = createContext<AppData | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<AppConfig>({})
  const [master, setMaster] = useState<Master>(() => seedMaster())
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [schoolId, setSchoolId] = useState<string | null>(() => lsGet<string | null>(SCHOOL_ID_KEY, null))
  const [school, setSchool] = useState<SchoolDoc | null>(null)
  const [schoolStatus, setSchoolStatus] = useState<SchoolStatus>('off')
  const [schoolError, setSchoolError] = useState<string | null>(null)
  const [user, setUser] = useState<AccountUser | null>(null)
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const configRef = useRef<AppConfig>({})
  const masterRef = useRef<Master>(master)
  masterRef.current = master
  // 공유 저장은 타이핑마다 쓰지 않고 잠시 모아서 한 번에 보낸다 (무료 한도 절약)
  const remoteTimer = useRef<number | null>(null)
  const pendingRemote = useRef<Master | null>(null)
  const ownerRef = useRef<{ schoolId: string | null; canWrite: boolean }>({ schoolId: null, canWrite: false })

  /** 학교 문서의 과목·출판사를 화면이 쓰는 마스터에 반영하고 로컬에도 캐시한다 */
  const applySchool = useCallback((doc: SchoolDoc) => {
    const next: Master = { ...masterRef.current, subjects: doc.subjects || [], publishers: doc.publishers || [], settings: { ...masterRef.current.settings, schoolName: doc.schoolName || masterRef.current.settings.schoolName } }
    masterRef.current = next
    setMaster(next)
    saveMasterLocal(next)
    setSchool(doc)
  }, [])

  // 최초 1회: 설정·로컬 데이터 로드 → 학교 아이디가 있으면 공유 과목·출판사 가져오기
  useEffect(() => {
    let cancelled = false
    let unsubAuth: (() => void) | undefined
    ;(async () => {
      const cfg = await loadConfig()
      if (cancelled) return
      configRef.current = cfg
      setConfig(cfg)

      const rawMaster = loadMaster()
      const m = rawMaster ? migrateMaster(rawMaster) : seedMaster({ schoolName: cfg.schoolName, year: cfg.year })
      // 정리한 결과(예전 과목·출판사 비우기 포함)를 바로 저장해 둔다
      saveMasterLocal(m)
      masterRef.current = m
      setMaster(m)
      setEvaluations(loadEvaluations().map((e) => migrateEvaluation(e, m)).filter((e): e is Evaluation => !!e))
      setSummaries(loadSummaries().map(migrateSummary).filter((s): s is Summary => !!s))

      if (hasFirebaseConfig(cfg.firebase)) {
        unsubAuth = await watchAccount(cfg.firebase, (u) => !cancelled && setUser(u))
        setSchoolStatus(schoolId ? 'loading' : 'none')
      } else {
        setSchoolStatus('off')
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
      unsubAuth?.()
    }
    // 최초 1회만 실행한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 학교 아이디가 정해지면 문서를 읽고 변경을 구독한다
  useEffect(() => {
    const cfg = configRef.current
    if (!ready || !hasFirebaseConfig(cfg.firebase)) return
    if (!schoolId) {
      setSchool(null)
      setSchoolStatus('none')
      return
    }
    let cancelled = false
    let unsub: (() => void) | undefined
    setSchoolStatus('loading')
    ;(async () => {
      try {
        unsub = await subscribeSchool(
          cfg.firebase!,
          schoolId,
          (doc) => {
            if (cancelled) return
            if (doc) {
              applySchool(doc)
              setSchoolStatus('ok')
              setSchoolError(null)
            } else {
              setSchool(null)
              setSchoolStatus('missing')
            }
          },
          (e) => {
            if (cancelled) return
            setSchoolStatus('error')
            setSchoolError(authErrorText(e))
          },
        )
      } catch (e) {
        if (cancelled) return
        setSchoolStatus('error')
        setSchoolError(authErrorText(e))
      }
    })()
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [ready, schoolId, applySchool])

  const isOwner = !!(user && school && school.ownerUid === user.uid)
  const accountEnabled = hasFirebaseConfig(config.firebase)
  const superAdmin = accountEnabled && isSuperAdminEmail(config.firebase!, user?.email)
  ownerRef.current = { schoolId, canWrite: isOwner }

  /** 모아 둔 과목·출판사 변경을 학교 문서에 보낸다 */
  const flushRemote = useCallback(async () => {
    const cfg = configRef.current
    const m = pendingRemote.current
    const { schoolId: id, canWrite } = ownerRef.current
    pendingRemote.current = null
    if (!m || !id || !canWrite || !hasFirebaseConfig(cfg.firebase)) return
    try {
      await saveSchoolData(cfg.firebase, id, { schoolName: m.settings.schoolName, subjects: m.subjects, publishers: m.publishers })
    } catch (e) {
      setAuthError(authErrorText(e))
    }
  }, [])

  // 화면을 떠날 때 남은 변경을 마저 보낸다
  useEffect(() => {
    const onLeave = () => {
      if (remoteTimer.current) window.clearTimeout(remoteTimer.current)
      flushRemote()
    }
    window.addEventListener('beforeunload', onLeave)
    return () => {
      window.removeEventListener('beforeunload', onLeave)
      onLeave()
    }
  }, [flushRemote])

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true)
    setAuthError(null)
    try {
      return await fn()
    } catch (e) {
      setAuthError(authErrorText(e))
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  const attachSchool = useCallback(
    async (raw: string): Promise<boolean> => {
      const cfg = configRef.current
      if (!hasFirebaseConfig(cfg.firebase)) return false
      const id = normalizeSchoolId(raw)
      const ok = await run(async () => {
        const doc = await fetchSchool(cfg.firebase!, id)
        if (!doc) throw new Error(`'${id}' 학교 아이디를 찾을 수 없습니다. 담당 선생님께 확인해 주세요.`)
        return doc
      })
      if (!ok) return false
      lsSet(SCHOOL_ID_KEY, id)
      setSchoolId(id)
      applySchool(ok)
      setSchoolStatus('ok')
      return true
    },
    [run, applySchool],
  )

  const detachSchool = useCallback(() => {
    lsSet(SCHOOL_ID_KEY, null)
    setSchoolId(null)
    setSchool(null)
    setSchoolStatus(hasFirebaseConfig(configRef.current.firebase) ? 'none' : 'off')
  }, [])

  const signUp = useCallback(
    async ({ email, password, schoolId: rawId, schoolName }: { email: string; password: string; schoolId: string; schoolName: string }): Promise<boolean> => {
      const cfg = configRef.current
      if (!hasFirebaseConfig(cfg.firebase)) return false
      const id = normalizeSchoolId(rawId)
      const res = await run(async () => {
        const exists = await fetchSchool(cfg.firebase!, id)
        if (exists) throw new Error(`'${id}' 는 이미 사용 중인 학교 아이디입니다. 다른 아이디를 정해 주세요.`)
        const u = await fbSignUp(cfg.firebase!, email, password)
        const now = new Date().toISOString()
        const doc: SchoolDoc = {
          schoolId: id,
          schoolName: schoolName.trim() || masterRef.current.settings.schoolName,
          ownerUid: u.uid,
          subjects: masterRef.current.subjects,
          publishers: masterRef.current.publishers,
          createdAt: now,
          updatedAt: now,
        }
        await createSchool(cfg.firebase!, doc, u.email)
        return doc
      })
      if (!res) return false
      lsSet(SCHOOL_ID_KEY, id)
      setSchoolId(id)
      applySchool(res)
      setSchoolStatus('ok')
      return true
    },
    [run, applySchool],
  )

  const changeSchoolId = useCallback(
    async (raw: string): Promise<boolean> => {
      const cfg = configRef.current
      if (!hasFirebaseConfig(cfg.firebase) || !school || !user || school.ownerUid !== user.uid) return false
      const oldId = school.schoolId
      const next = normalizeSchoolId(raw)
      const res = await run(async () => {
        const err = schoolIdError(raw)
        if (err) throw new Error(err)
        if (next === oldId) throw new Error('지금 쓰고 있는 아이디와 같습니다.')
        const taken = await fetchSchool(cfg.firebase!, next)
        if (taken) throw new Error(`'${next}' 는 이미 사용 중인 학교 아이디입니다. 다른 아이디를 정해 주세요.`)
        // 아직 보내지 않은 과목·출판사 변경이 옛 아이디로 가지 않도록 여기서 함께 옮긴다
        if (remoteTimer.current) window.clearTimeout(remoteTimer.current)
        const base = pendingRemote.current || masterRef.current
        pendingRemote.current = null
        const doc: SchoolDoc = {
          ...school,
          schoolId: next,
          schoolName: base.settings.schoolName || school.schoolName,
          subjects: base.subjects,
          publishers: base.publishers,
          updatedAt: new Date().toISOString(),
        }
        await renameSchool(cfg.firebase!, oldId, doc, user.email)
        return doc
      })
      if (!res) return false
      lsSet(SCHOOL_ID_KEY, next)
      setSchoolId(next)
      applySchool(res)
      setSchoolStatus('ok')
      return true
    },
    [run, applySchool, school, user],
  )

  const signIn = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      const cfg = configRef.current
      if (!hasFirebaseConfig(cfg.firebase)) return false
      const u = await run(() => fbSignIn(cfg.firebase!, email, password))
      return !!u
    },
    [run],
  )

  const signOut = useCallback(async () => {
    const cfg = configRef.current
    if (!hasFirebaseConfig(cfg.firebase)) return
    await run(() => signOutAccount(cfg.firebase!))
    setUser(null)
  }, [run])

  const sendReset = useCallback(
    async (email: string): Promise<boolean> => {
      const cfg = configRef.current
      if (!hasFirebaseConfig(cfg.firebase)) return false
      const r = await run(async () => {
        await fbSendReset(cfg.firebase!, email)
        return true
      })
      return !!r
    },
    [run],
  )

  const changePassword = useCallback(
    async (current: string, next: string): Promise<boolean> => {
      const cfg = configRef.current
      if (!hasFirebaseConfig(cfg.firebase)) return false
      const r = await run(async () => {
        await fbChangePassword(cfg.firebase!, current, next)
        return true
      })
      return !!r
    },
    [run],
  )

  const deleteAccount = useCallback(
    async (current: string): Promise<boolean> => {
      const cfg = configRef.current
      if (!hasFirebaseConfig(cfg.firebase)) return false
      const owned = school && user && school.ownerUid === user.uid ? school.schoolId : null
      const r = await run(async () => {
        await fbDeleteAccount(cfg.firebase!, current, owned)
        return true
      })
      if (!r) return false
      lsSet(SCHOOL_ID_KEY, null)
      setSchoolId(null)
      setSchool(null)
      setUser(null)
      setSchoolStatus('none')
      return true
    },
    [run, school, user],
  )

  const signInGoogle = useCallback(async (): Promise<boolean> => {
    const cfg = configRef.current
    if (!hasFirebaseConfig(cfg.firebase)) return false
    const r = await run(async () => {
      await signInWithGoogle(cfg.firebase!)
      return true
    })
    return !!r
  }, [run])

  const clearAuthError = useCallback(() => setAuthError(null), [])

  const saveMaster = useCallback(
    async (m: Master) => {
      const next = { ...m, updatedAt: new Date().toISOString() }
      masterRef.current = next
      setMaster(next)
      saveMasterLocal(next)
      // 과목·출판사는 담당자 계정으로 로그인했을 때만 학교 문서에 함께 저장된다.
      // 글자를 칠 때마다 보내지 않도록 2초 모았다가 한 번만 쓴다.
      const { schoolId: id, canWrite } = ownerRef.current
      if (!id || !canWrite || !hasFirebaseConfig(configRef.current.firebase)) return
      pendingRemote.current = next
      if (remoteTimer.current) window.clearTimeout(remoteTimer.current)
      remoteTimer.current = window.setTimeout(flushRemote, 2000)
    },
    [flushRemote],
  )

  const saveEvaluation = useCallback(async (e: Evaluation) => {
    const next = { ...e, updatedAt: new Date().toISOString() }
    setEvaluations((list) => {
      const i = list.findIndex((x) => x.id === next.id)
      const copy = i >= 0 ? list.map((x, j) => (j === i ? next : x)) : [...list, next]
      saveEvaluations(copy)
      return copy
    })
  }, [])

  const deleteEvaluation = useCallback(async (id: string) => {
    setEvaluations((list) => {
      const copy = list.filter((x) => x.id !== id)
      saveEvaluations(copy)
      return copy
    })
  }, [])

  const saveSummary = useCallback(async (s: Summary) => {
    const next = { ...s, updatedAt: new Date().toISOString() }
    setSummaries((list) => {
      const i = list.findIndex((x) => x.id === next.id)
      const copy = i >= 0 ? list.map((x, j) => (j === i ? next : x)) : [...list, next]
      saveSummaries(copy)
      return copy
    })
  }, [])

  const deleteSummary = useCallback(async (id: string) => {
    setSummaries((list) => {
      const copy = list.filter((x) => x.id !== id)
      saveSummaries(copy)
      return copy
    })
  }, [])

  const resetMaster = useCallback(async () => {
    await saveMaster(seedMaster({ schoolName: configRef.current.schoolName, year: configRef.current.year }))
  }, [saveMaster])

  const value = useMemo<AppData>(
    () => ({
      ready,
      config,
      master,
      evaluations,
      summaries,
      schoolStatus,
      schoolId,
      school,
      schoolError,
      accountEnabled,
      user,
      isOwner,
      isSuperAdmin: superAdmin,
      busy,
      authError,
      attachSchool,
      detachSchool,
      signUp,
      changeSchoolId,
      signIn,
      signOut,
      signInGoogle,
      sendReset,
      changePassword,
      deleteAccount,
      clearAuthError,
      saveMaster,
      saveEvaluation,
      deleteEvaluation,
      saveSummary,
      deleteSummary,
      resetMaster,
    }),
    [ready, config, master, evaluations, summaries, schoolStatus, schoolId, school, schoolError, accountEnabled, user, isOwner, superAdmin, busy, authError, attachSchool, detachSchool, signUp, changeSchoolId, signIn, signOut, signInGoogle, sendReset, changePassword, deleteAccount, clearAuthError, saveMaster, saveEvaluation, deleteEvaluation, saveSummary, deleteSummary, resetMaster],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppData(): AppData {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppDataProvider missing')
  return v
}

// ───────────── 해시 라우터 ─────────────
export function useHashRoute(): [string, (h: string) => void] {
  const [hash, setHash] = useState(() => location.hash.replace(/^#\/?/, '') || '')
  useEffect(() => {
    const onChange = () => setHash(location.hash.replace(/^#\/?/, '') || '')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const go = useCallback((h: string) => {
    location.hash = h ? `#/${h}` : ''
  }, [])
  return [hash, go]
}

export function fmtDate(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
