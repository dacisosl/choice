import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppConfig, Catalog, Evaluation, Master, Summary } from '../types'
import { seedMaster } from '../seed'
import { loadCatalog, loadConfig, loadEvaluations, loadMaster, loadSummaries, lsGet, lsSet, saveEvaluations, saveMasterLocal, saveSummaries } from './storage'
import { applyCatalog, catalogStamp } from './catalog'
import { migrateEvaluation, migrateMaster, migrateSummary } from './migrate'

const CATALOG_STAMP_KEY = 'choice.catalogStamp'

export interface AppData {
  ready: boolean
  config: AppConfig
  master: Master
  evaluations: Evaluation[]
  summaries: Summary[]
  /** 앱과 함께 배포된 교과서 자료 (public/catalog.json). 없으면 null */
  catalog: Catalog | null

  saveMaster: (m: Master) => Promise<void>
  saveEvaluation: (e: Evaluation) => Promise<void>
  deleteEvaluation: (id: string) => Promise<void>
  saveSummary: (s: Summary) => Promise<void>
  deleteSummary: (id: string) => Promise<void>
  resetMaster: () => Promise<void>
  /** 교과서 자료를 다시 읽어 과목·출판사 목록을 새로 채운다 (직접 넣은 항목은 그대로) */
  reloadCatalog: () => Promise<void>
}

const Ctx = createContext<AppData | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<AppConfig>({})
  const [master, setMaster] = useState<Master>(() => seedMaster())
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const configRef = useRef<AppConfig>({})
  const masterRef = useRef<Master>(master)
  masterRef.current = master

  // 최초 1회: 설정·이 컴퓨터의 문서 → 교과서 자료 순서로 읽는다
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cfg = await loadConfig()
      if (cancelled) return
      configRef.current = cfg
      setConfig(cfg)

      const rawMaster = loadMaster()
      let m = rawMaster ? migrateMaster(rawMaster) : seedMaster({ schoolName: cfg.schoolName, year: cfg.year })

      // 교과서 자료가 있으면 과목·출판사를 채운다. 자료가 갱신됐을 때만 덮어쓴다.
      const cat = await loadCatalog()
      if (cancelled) return
      setCatalog(cat)
      if (cat) {
        const stamp = catalogStamp(cat)
        const seen = lsGet<string>(CATALOG_STAMP_KEY, '')
        // 자료에 과목이 있는데 이 컴퓨터에 하나도 없으면(지웠다가 다시 온 경우) 다시 채운다
        const noneYet = cat.subjects.length > 0 && !m.subjects.some((s) => s.source === 'catalog')
        if (stamp !== seen || noneYet) {
          m = applyCatalog(m, cat)
          lsSet(CATALOG_STAMP_KEY, stamp)
        }
      }

      saveMasterLocal(m)
      masterRef.current = m
      setMaster(m)
      setEvaluations(loadEvaluations().map((e) => migrateEvaluation(e, m)).filter((e): e is Evaluation => !!e))
      setSummaries(loadSummaries().map(migrateSummary).filter((s): s is Summary => !!s))
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const saveMaster = useCallback(async (m: Master) => {
    const next = { ...m, updatedAt: new Date().toISOString() }
    masterRef.current = next
    setMaster(next)
    saveMasterLocal(next)
  }, [])

  const reloadCatalog = useCallback(async () => {
    const cat = await loadCatalog()
    setCatalog(cat)
    if (!cat) return
    const next = applyCatalog(masterRef.current, cat)
    lsSet(CATALOG_STAMP_KEY, catalogStamp(cat))
    await saveMaster(next)
  }, [saveMaster])

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
    const base = seedMaster({ schoolName: configRef.current.schoolName, year: configRef.current.year })
    await saveMaster(catalog ? applyCatalog(base, catalog) : base)
  }, [saveMaster, catalog])

  const value = useMemo<AppData>(
    () => ({
      ready,
      config,
      master,
      evaluations,
      summaries,
      catalog,
      saveMaster,
      saveEvaluation,
      deleteEvaluation,
      saveSummary,
      deleteSummary,
      resetMaster,
      reloadCatalog,
    }),
    [ready, config, master, evaluations, summaries, catalog, saveMaster, saveEvaluation, deleteEvaluation, saveSummary, deleteSummary, resetMaster, reloadCatalog],
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
