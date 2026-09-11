import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppConfig, Evaluation, Master, Summary } from '../types'
import { seedMaster } from '../seed'
import { createStore, LocalStore, type Store, type StorageMode } from './storage'
import { useAuth } from './auth'

export interface AppData {
  ready: boolean
  error: string | null
  mode: StorageMode
  config: AppConfig
  master: Master
  evaluations: Evaluation[]
  summaries: Summary[]
  saveMaster: (m: Master) => Promise<void>
  saveEvaluation: (e: Evaluation) => Promise<void>
  deleteEvaluation: (id: string) => Promise<void>
  saveSummary: (s: Summary) => Promise<void>
  deleteSummary: (id: string) => Promise<void>
  refresh: () => Promise<void>
  resetMaster: () => Promise<void>
}

const Ctx = createContext<AppData | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { ready: authReady, enabled: authEnabled, isApproved, config } = useAuth()
  const storeRef = useRef<Store | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<StorageMode>('local')
  const [master, setMaster] = useState<Master>(() => seedMaster())
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [summaries, setSummaries] = useState<Summary[]>([])

  const loadAll = useCallback(async (store: Store, cfg: AppConfig) => {
    let m = await store.getMaster()
    if (!m) {
      m = seedMaster({ schoolName: cfg.schoolName, year: cfg.year })
      // 마스터 생성 권한이 없는 일반 구성원일 수 있으므로 저장 실패는 넘어간다
      try {
        await store.saveMaster(m)
      } catch {
        /* 관리자가 최초 1회 생성 */
      }
    }
    const [evs, sums] = await Promise.all([store.listEvaluations(), store.listSummaries()])
    setMaster(m)
    setEvaluations(evs)
    setSummaries(sums)
  }, [])

  useEffect(() => {
    // 로그인 방식일 때는 승인된 뒤에 데이터를 읽는다
    if (!authReady) return
    if (authEnabled && !isApproved) {
      setReady(true)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        let store = await createStore(config)
        if (cancelled) return
        try {
          await loadAll(store, config)
          setError(null)
        } catch (e) {
          if (store.mode === 'local') throw e
          // 온라인 저장소 접근 실패(예: 규칙 미허용) → 데이터 유실 없이 로컬 모드로 전환
          store = new LocalStore()
          await loadAll(store, config)
          setError(
            `온라인 저장소에 연결하지 못해 이 브라우저 저장 모드로 전환했습니다. Firestore 규칙을 게시했는지 확인하세요. (${(e as Error).message})`,
          )
        }
        if (cancelled) return
        storeRef.current = store
        setMode(store.mode)
      } catch (e) {
        setError(`데이터 불러오기 실패: ${(e as Error).message}`)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authReady, authEnabled, isApproved, config, loadAll])

  const refresh = useCallback(async () => {
    const store = storeRef.current
    if (!store) return
    try {
      await loadAll(store, config)
      setError(null)
    } catch (e) {
      setError(`새로고침 실패: ${(e as Error).message}`)
    }
  }, [loadAll, config])

  const saveMaster = useCallback(async (m: Master) => {
    const next = { ...m, updatedAt: new Date().toISOString() }
    setMaster(next)
    await storeRef.current?.saveMaster(next)
  }, [])

  const saveEvaluation = useCallback(async (e: Evaluation) => {
    const next = { ...e, updatedAt: new Date().toISOString() }
    setEvaluations((list) => {
      const i = list.findIndex((x) => x.id === next.id)
      if (i >= 0) {
        const copy = [...list]
        copy[i] = next
        return copy
      }
      return [...list, next]
    })
    await storeRef.current?.saveEvaluation(next)
  }, [])

  const deleteEvaluation = useCallback(async (id: string) => {
    setEvaluations((list) => list.filter((x) => x.id !== id))
    await storeRef.current?.deleteEvaluation(id)
  }, [])

  const saveSummary = useCallback(async (s: Summary) => {
    const next = { ...s, updatedAt: new Date().toISOString() }
    setSummaries((list) => {
      const i = list.findIndex((x) => x.id === next.id)
      if (i >= 0) {
        const copy = [...list]
        copy[i] = next
        return copy
      }
      return [...list, next]
    })
    await storeRef.current?.saveSummary(next)
  }, [])

  const deleteSummary = useCallback(async (id: string) => {
    setSummaries((list) => list.filter((x) => x.id !== id))
    await storeRef.current?.deleteSummary(id)
  }, [])

  const resetMaster = useCallback(async () => {
    const m = seedMaster({ schoolName: config.schoolName, year: config.year })
    await saveMaster(m)
  }, [config, saveMaster])

  const value = useMemo<AppData>(
    () => ({
      ready,
      error,
      mode,
      config,
      master,
      evaluations,
      summaries,
      saveMaster,
      saveEvaluation,
      deleteEvaluation,
      saveSummary,
      deleteSummary,
      refresh,
      resetMaster,
    }),
    [ready, error, mode, config, master, evaluations, summaries, saveMaster, saveEvaluation, deleteEvaluation, saveSummary, deleteSummary, refresh, resetMaster],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppData(): AppData {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppDataProvider missing')
  return v
}

// ───────────── 역할 잠금 (코드 방식, 로컬 모드 전용) ─────────────
export type Role = 'teacher' | 'compiler' | 'admin'
const ROLE_KEY = 'choice.roles'

export function getUnlockedRoles(): Role[] {
  try {
    return JSON.parse(sessionStorage.getItem(ROLE_KEY) || '[]') as Role[]
  } catch {
    return []
  }
}
export function unlockRole(r: Role): void {
  const set = new Set(getUnlockedRoles())
  set.add(r)
  sessionStorage.setItem(ROLE_KEY, JSON.stringify([...set]))
}
export function lockAll(): void {
  sessionStorage.removeItem(ROLE_KEY)
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
