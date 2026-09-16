import type { Criterion, Evaluation, Master, Settings, Summary } from '../types'
import { DATA_VERSION, DEFAULT_SETTINGS, LEGACY_DEFAULT_CRITERIA, seedCriteria, seedMaster } from '../seed'
import { criteriaFor, publishersFor } from '../lib/scoring'

/** 예전 구조(접속 코드·위원 명단·과목 마감 등)의 마스터를 현재 구조로 정리한다 */
export function migrateMaster(raw: unknown): Master {
  const base = seedMaster()
  if (!raw || typeof raw !== 'object') return base
  const m = raw as Partial<Master> & { committee?: unknown; settings?: Partial<Settings> & Record<string, unknown> }
  const s = { ...DEFAULT_SETTINGS, ...(m.settings || {}) } as Settings & Record<string, unknown>
  for (const k of ['accessCode', 'compilerCode', 'adminCode', 'aiModel', 'aiFallbackModel', 'aiMaxPerDoc']) delete s[k]
  // 예전 버전에서 이 컴퓨터에 넣어 둔 과목·출판사는 한 번만 비운다
  const stale = (m.version || 0) < DATA_VERSION
  return {
    version: DATA_VERSION,
    settings: s as Settings,
    subjects: stale
      ? []
      : (m.subjects || []).map((x) => {
          const { status: _s, ...rest } = x as typeof x & { status?: unknown }
          return rest
        }),
    publishers: stale ? [] : m.publishers || [],
    criteria: refreshDefaultCriteria(m.criteria && m.criteria.length ? m.criteria : base.criteria),
    opinionOptions: m.opinionOptions && m.opinionOptions.length ? m.opinionOptions : base.opinionOptions,
    updatedAt: m.updatedAt || base.updatedAt,
  }
}

/**
 * 기본 평가기준이 예전 기본값 그대로(손대지 않은 상태)면 새 기본값으로 바꾼다.
 * 선생님이 고쳐 둔 기준이나 과목 전용 기준은 건드리지 않는다.
 */
function refreshDefaultCriteria(list: Criterion[]): Criterion[] {
  const defaults = list.filter((c) => c.subjectId === null).sort((a, b) => a.order - b.order)
  const untouched = LEGACY_DEFAULT_CRITERIA.some(
    (legacy) => defaults.length === legacy.length && defaults.every((c, i) => c.area === legacy[i].area && c.text === legacy[i].text && c.points === legacy[i].points),
  )
  if (!untouched) return list
  return [...list.filter((c) => c.subjectId !== null), ...seedCriteria()]
}

/**
 * 예전 개인 문서(출판사·평가기준 스냅샷 없음)는 로컬 마스터에서 채워 넣는다.
 * 채울 수 없으면(출판사를 알 수 없음) null 을 돌려 버린다.
 */
export function migrateEvaluation(raw: unknown, master: Master): Evaluation | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Partial<Evaluation> & { status?: unknown; uid?: unknown; submittedAt?: unknown }
  if (!e.id || !e.subjectId || !e.scores) return null
  const subject = master.subjects.find((s) => s.id === e.subjectId)
  const publishers = e.publishers && e.publishers.length ? e.publishers : publishersFor(master, e.subjectId).map((p) => ({ id: p.id, name: p.name }))
  const criteria: Criterion[] = e.criteria && e.criteria.length ? e.criteria : criteriaFor(master, e.subjectId)
  if (!publishers.length) return null
  const { status: _st, uid: _u, submittedAt: _sa, ...rest } = e
  return {
    ...(rest as Evaluation),
    subjectName: e.subjectName || subject?.name || '',
    teacherName: e.teacherName || '',
    publishers,
    criteria,
    ranks: e.ranks || [null, null, null],
    summaryKeys: e.summaryKeys || [],
    summaryOpinion: e.summaryOpinion || '',
    recommend: e.recommend || [],
    updatedAt: e.updatedAt || new Date().toISOString(),
  }
}

/** 예전 총괄표(memberColumns/evaluationId 구조)는 버린다. 새 구조만 남긴다 */
export function migrateSummary(raw: unknown): Summary | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<Summary>
  if (!s.id || !s.subjectId || !s.members || !s.publishers) return null
  return s as Summary
}
