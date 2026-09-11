import type { AppConfig, Evaluation, FirebaseConfig, Master, Summary } from '../types'

export type StorageMode = 'local' | 'supabase' | 'firebase'

export interface Store {
  mode: StorageMode
  getMaster(): Promise<Master | null>
  saveMaster(m: Master): Promise<void>
  listEvaluations(): Promise<Evaluation[]>
  saveEvaluation(e: Evaluation): Promise<void>
  deleteEvaluation(id: string): Promise<void>
  listSummaries(): Promise<Summary[]>
  saveSummary(s: Summary): Promise<void>
}

// ───────────── localStorage ─────────────
const LS = {
  master: 'choice.master',
  evaluations: 'choice.evaluations',
  summaries: 'choice.summaries',
}

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function lsSet(key: string, v: unknown): void {
  localStorage.setItem(key, JSON.stringify(v))
}

export class LocalStore implements Store {
  mode: StorageMode = 'local'
  async getMaster() {
    return lsGet<Master | null>(LS.master, null)
  }
  async saveMaster(m: Master) {
    lsSet(LS.master, m)
  }
  async listEvaluations() {
    return lsGet<Evaluation[]>(LS.evaluations, [])
  }
  async saveEvaluation(e: Evaluation) {
    const list = await this.listEvaluations()
    const i = list.findIndex((x) => x.id === e.id)
    if (i >= 0) list[i] = e
    else list.push(e)
    lsSet(LS.evaluations, list)
  }
  async deleteEvaluation(id: string) {
    lsSet(LS.evaluations, (await this.listEvaluations()).filter((x) => x.id !== id))
  }
  async listSummaries() {
    return lsGet<Summary[]>(LS.summaries, [])
  }
  async saveSummary(s: Summary) {
    const list = await this.listSummaries()
    const i = list.findIndex((x) => x.id === s.id)
    if (i >= 0) list[i] = s
    else list.push(s)
    lsSet(LS.summaries, list)
  }
}

// ───────────── Supabase (docs 테이블) ─────────────
type SupaClient = import('@supabase/supabase-js').SupabaseClient

export class SupabaseStore implements Store {
  mode: StorageMode = 'supabase'
  constructor(private client: SupaClient) {}

  static async create(url: string, anonKey: string): Promise<SupabaseStore> {
    const { createClient } = await import('@supabase/supabase-js')
    return new SupabaseStore(createClient(url, anonKey))
  }

  private async upsert(id: string, kind: string, subjectId: string | null, data: unknown) {
    const { error } = await this.client
      .from('docs')
      .upsert({ id, kind, subject_id: subjectId, data, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
  }
  private async listKind<T>(kind: string): Promise<T[]> {
    const { data, error } = await this.client.from('docs').select('data').eq('kind', kind)
    if (error) throw new Error(error.message)
    return (data || []).map((r: { data: T }) => r.data)
  }

  async getMaster() {
    const { data, error } = await this.client.from('docs').select('data').eq('id', 'master').maybeSingle()
    if (error) throw new Error(error.message)
    return (data?.data as Master) ?? null
  }
  async saveMaster(m: Master) {
    await this.upsert('master', 'master', null, m)
  }
  async listEvaluations() {
    return this.listKind<Evaluation>('evaluation')
  }
  async saveEvaluation(e: Evaluation) {
    await this.upsert(e.id, 'evaluation', e.subjectId, e)
  }
  async deleteEvaluation(id: string) {
    const { error } = await this.client.from('docs').delete().eq('id', id)
    if (error) throw new Error(error.message)
  }
  async listSummaries() {
    return this.listKind<Summary>('summary')
  }
  async saveSummary(s: Summary) {
    await this.upsert(s.id, 'summary', s.subjectId, s)
  }
}

// ───────────── Firebase Firestore (docs 컬렉션) ─────────────
type Firestore = import('firebase/firestore').Firestore

export class FirestoreStore implements Store {
  mode: StorageMode = 'firebase'
  private constructor(
    private db: Firestore,
    private fs: typeof import('firebase/firestore'),
  ) {}

  static async create(cfg: FirebaseConfig): Promise<FirestoreStore> {
    const [{ initializeApp, getApps }, fs] = await Promise.all([import('firebase/app'), import('firebase/firestore')])
    const app = getApps()[0] || initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId })
    return new FirestoreStore(fs.getFirestore(app), fs)
  }

  private async upsert(id: string, kind: string, subjectId: string | null, data: unknown) {
    // Firestore는 undefined 값을 허용하지 않으므로 JSON 왕복으로 제거
    const clean = JSON.parse(JSON.stringify(data))
    await this.fs.setDoc(this.fs.doc(this.db, 'docs', id), { kind, subject_id: subjectId, data: clean, updated_at: new Date().toISOString() })
  }
  private async listKind<T>(kind: string): Promise<T[]> {
    const q = this.fs.query(this.fs.collection(this.db, 'docs'), this.fs.where('kind', '==', kind))
    const snap = await this.fs.getDocs(q)
    return snap.docs.map((d) => d.data().data as T)
  }

  async getMaster() {
    const snap = await this.fs.getDoc(this.fs.doc(this.db, 'docs', 'master'))
    return snap.exists() ? (snap.data().data as Master) : null
  }
  async saveMaster(m: Master) {
    await this.upsert('master', 'master', null, m)
  }
  async listEvaluations() {
    return this.listKind<Evaluation>('evaluation')
  }
  async saveEvaluation(e: Evaluation) {
    await this.upsert(e.id, 'evaluation', e.subjectId, e)
  }
  async deleteEvaluation(id: string) {
    await this.fs.deleteDoc(this.fs.doc(this.db, 'docs', id))
  }
  async listSummaries() {
    return this.listKind<Summary>('summary')
  }
  async saveSummary(s: Summary) {
    await this.upsert(s.id, 'summary', s.subjectId, s)
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

/** 관리 화면에서 브라우저별로 덮어쓴 Supabase 설정 */
const OVERRIDE_KEY = 'choice.supabaseOverride'
export function getSupabaseOverride(): { url: string; key: string } | null {
  return lsGet<{ url: string; key: string } | null>(OVERRIDE_KEY, null)
}
export function setSupabaseOverride(v: { url: string; key: string } | null): void {
  if (v && v.url && v.key) lsSet(OVERRIDE_KEY, v)
  else localStorage.removeItem(OVERRIDE_KEY)
}

export async function createStore(cfg: AppConfig): Promise<Store> {
  const ov = getSupabaseOverride()
  const url = ov?.url || cfg.supabaseUrl || ''
  const key = ov?.key || cfg.supabaseAnonKey || ''
  if (url && key) {
    try {
      return await SupabaseStore.create(url, key)
    } catch (e) {
      console.warn('Supabase 초기화 실패, 로컬 모드로 전환', e)
    }
  }
  const fb = cfg.firebase
  if (fb && fb.apiKey && fb.projectId) {
    try {
      return await FirestoreStore.create(fb)
    } catch (e) {
      console.warn('Firebase 초기화 실패, 로컬 모드로 전환', e)
    }
  }
  return new LocalStore()
}
