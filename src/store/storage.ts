import type { AppConfig, Evaluation, Master, Summary } from '../types'

/**
 * 이 컴퓨터(localStorage) 저장. 개인 평가표·총괄표는 여기에만 있다.
 * 마스터는 로컬 캐시이며, 공유가 켜져 있으면 Firestore 사본으로 덮어써진다 (shared.ts).
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

export async function loadConfig(): Promise<AppConfig> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' })
    if (!res.ok) return {}
    return (await res.json()) as AppConfig
  } catch {
    return {}
  }
}
