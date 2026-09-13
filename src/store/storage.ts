import type { AppConfig, Catalog, Evaluation, Master, Summary } from '../types'

/**
 * 이 컴퓨터(localStorage) 저장. 평가표·총괄표·과목·출판사 모두 여기에만 있다.
 * 서버로 보내는 것은 없다. 과목·출판사는 앱에 실려 오는 교과서 자료(catalog.json)로 채워진다.
 */
const LS = {
  master: 'choice.master',
  evaluations: 'choice.evaluations',
  summaries: 'choice.summaries',
}

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
export function lsSet(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch (e) {
    console.warn('localStorage 저장 실패', e)
  }
}

export const loadMaster = () => lsGet<Master | null>(LS.master, null)
export const saveMasterLocal = (m: Master) => lsSet(LS.master, m)
export const loadEvaluations = () => lsGet<Evaluation[]>(LS.evaluations, [])
export const saveEvaluations = (list: Evaluation[]) => lsSet(LS.evaluations, list)
export const loadSummaries = () => lsGet<Summary[]>(LS.summaries, [])
export const saveSummaries = (list: Summary[]) => lsSet(LS.summaries, list)

/** 앱과 함께 배포된 교과서 자료. 파일이 없거나 형식이 어긋나면 null */
export async function loadCatalog(): Promise<Catalog | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}catalog.json`, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as Catalog
    return Array.isArray(json?.subjects) ? json : null
  } catch {
    return null
  }
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' })
    if (!res.ok) return {}
    return (await res.json()) as AppConfig
  } catch {
    return {}
  }
}
