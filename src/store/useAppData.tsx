import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppConfig, Evaluation, Master, Summary } from '../types'
import { seedMaster } from '../seed'
import { createStore, loadConfig, type Store, type StorageMode } from './storage'

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
  refresh: () => Promise<void>
  resetMaster: () => Promise<void>
}

const Ctx = createContext<AppData | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<Store | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<StorageMode>('local')
  const [config, setConfig] = useState<AppConfig>({})
  const [master, setMaster] = useState<Master>(() => seedMaster())
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [summaries, setSummaries] = useState<Summary[]>([])

  const loadAll = useCallback(async (store: Store, cfg: AppConfig) => {
    let m = await store.getMaster()
    if (!m) {
      m = seedMaster({ schoolName: cfg.schoolName, year: cfg.year })
      await store.saveMaster(m)
    }
    const [evs, sums] = await Promise.all([store.listEvaluations(), store.listSummaries()])
    setMaster(m)
    setEvaluations(evs)
    setSummaries(sums)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await loadConfig()
        const store = await createStore(cfg)
        if (cancelled) return
        storeRef.current = store
        setConfig(cfg)
        setMode(store.mode)
        await loadAll(store, cfg)
        setError(null)
      } catch (e) {
        setError(`데이터 불러오기 실패: ${(e as Error).message}`)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadAll])

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
      refresh,
      resetMaster,
    }),
    [ready, error, mode, config, master, evaluations, summaries, saveMaster, saveEvaluation, deleteEvaluation, saveSummary, refresh, resetMaster],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppData(): AppData {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppDataProvider missing')
  return v
}

// ───────────── 역할 잠금 (세션 단위) ─────────────
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

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function fmtDate(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
