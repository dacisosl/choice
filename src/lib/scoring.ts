import type { Criterion, Evaluation, Master, Publisher, Settings } from '../types'

/** 결정적 해시 (seed용) */
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function seededRand(seed: number): () => number {
  let x = seed || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return ((x >>> 0) % 10000) / 10000
  }
}

/** 과목에 적용되는 평가기준 (과목별 오버라이드가 있으면 그것, 없으면 기본 템플릿) */
export function criteriaFor(master: Master, subjectId: string): Criterion[] {
  const own = master.criteria.filter((c) => c.subjectId === subjectId)
  const list = own.length ? own : master.criteria.filter((c) => c.subjectId === null)
  return [...list].sort((a, b) => a.order - b.order)
}

export function publishersFor(master: Master, subjectId: string): Publisher[] {
  return master.publishers.filter((p) => p.subjectId === subjectId).sort((a, b) => a.order - b.order)
}

export function targetFor(settings: Settings, rankIdx: number): number {
  const t = settings.targetScores
  return rankIdx === 0 ? t.r1 : rankIdx === 1 ? t.r2 : rankIdx === 2 ? t.r3 : t.other
}

/**
 * 순위 → 기준별 점수 초안.
 * 각 기준 점수 = round(w_i × 목표총점/100), 반올림 오차는 배점이 가장 큰 기준에서 보정.
 */
export function draftScores(
  criteria: Criterion[],
  target: number,
  jitterSeed?: string,
): Record<string, number> {
  const out: Record<string, number> = {}
  let sum = 0
  for (const c of criteria) {
    const v = Math.round((c.points * target) / 100)
    out[c.id] = v
    sum += v
  }
  if (criteria.length) {
    const biggest = [...criteria].sort((a, b) => b.points - a.points)[0]
    out[biggest.id] += target - sum
  }
  if (jitterSeed) {
    const rnd = seededRand(hashStr(jitterSeed))
    // 배점 큰 기준에서 ±1 이동 (합계 유지)
    const sorted = [...criteria].sort((a, b) => b.points - a.points)
    if (sorted.length >= 2) {
      const r = rnd()
      const delta = r < 0.33 ? -1 : r < 0.66 ? 0 : 1
      const a = sorted[0]
      const b = sorted[1]
      if (delta !== 0 && out[a.id] - delta <= a.points && out[b.id] + delta <= b.points && out[a.id] - delta >= 0 && out[b.id] + delta >= 0) {
        out[a.id] -= delta
        out[b.id] += delta
      }
    }
  }
  // 배점 초과 방지
  for (const c of criteria) if (out[c.id] > c.points) out[c.id] = c.points
  return out
}

export function buildDraftScores(master: Master, ev: Pick<Evaluation, 'subjectId' | 'teacherName' | 'ranks'>): Evaluation['scores'] {
  const criteria = criteriaFor(master, ev.subjectId)
  const pubs = publishersFor(master, ev.subjectId)
  const scores: Evaluation['scores'] = {}
  for (const p of pubs) {
    const rankIdx = ev.ranks.indexOf(p.id)
    const target = targetFor(master.settings, rankIdx)
    const seed = master.settings.jitter ? `${ev.teacherName}|${ev.subjectId}|${p.id}` : undefined
    scores[p.id] = draftScores(criteria, target, seed)
  }
  return scores
}

export function columnTotal(scores: Record<string, number> | undefined, criteria: Criterion[]): number {
  if (!scores) return 0
  return criteria.reduce((s, c) => s + (Number(scores[c.id]) || 0), 0)
}

export function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round(n * f) / f
}

/** 평균 내림차순 순위 (동점은 같은 순위, 다음 순위는 건너뜀: 1,1,3) */
export function rankByAverage(avgs: Record<string, number>): Record<string, number> {
  const entries = Object.entries(avgs).sort((a, b) => b[1] - a[1])
  const ranks: Record<string, number> = {}
  let pos = 0
  let prev: number | null = null
  let prevRank = 0
  for (const [id, v] of entries) {
    pos++
    if (prev !== null && v === prev) ranks[id] = prevRank
    else {
      ranks[id] = pos
      prevRank = pos
    }
    prev = v
  }
  return ranks
}

export function rankLabel(rank: number, tieCount: number): string {
  return tieCount > 1 ? `공동 ${rank}순위` : `${rank}순위`
}

export interface SummaryComputed {
  totals: Record<string, number>
  averages: Record<string, number>
  ranks: Record<string, number>
  tieCounts: Record<number, number>
}

export function computeSummary(
  matrix: Record<string, Record<string, number>>,
  pubIds: string[],
  evalIds: string[],
  decimals: number,
): SummaryComputed {
  const totals: Record<string, number> = {}
  const averages: Record<string, number> = {}
  for (const pid of pubIds) {
    const row = matrix[pid] || {}
    const vals = evalIds.map((e) => Number(row[e]) || 0)
    const total = vals.reduce((a, b) => a + b, 0)
    totals[pid] = total
    averages[pid] = evalIds.length ? roundTo(total / evalIds.length, decimals) : 0
  }
  const ranks = rankByAverage(averages)
  const tieCounts: Record<number, number> = {}
  for (const r of Object.values(ranks)) tieCounts[r] = (tieCounts[r] || 0) + 1
  return { totals, averages, ranks, tieCounts }
}
