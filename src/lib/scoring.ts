import type { Criterion, DocPublisher, Evaluation, Master, Publisher, Settings } from '../types'

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

/** 정수 난수 [a, b] */
function randInt(rng: () => number, a: number, b: number): number {
  return a + Math.floor(rng() * (b - a + 1))
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * 목표 총점을 기준별로 "자연스럽게" 나눈다.
 * 기준마다 상한의 55~100% 사이 무작위 가중치를 주고 목표에 맞게 비례 조정한 뒤,
 * 상한을 넘는 몫은 여유 있는 기준으로 돌린다. 반올림 오차는 무작위 순서로 ±1 보정.
 */
function distributeNatural(criteria: Criterion[], target: number, rng: () => number): Record<string, number> {
  if (!criteria.length) return {}
  const max = criteria.map((c) => c.points)
  const raw = max.map((m) => m * (0.55 + 0.45 * rng()))
  const rawSum = raw.reduce((a, b) => a + b, 0)
  let vals = raw.map((r, i) => Math.min(max[i], (r * target) / rawSum))
  for (let k = 0; k < 8; k++) {
    const cur = vals.reduce((a, b) => a + b, 0)
    const deficit = target - cur
    if (Math.abs(deficit) < 0.01) break
    const room = vals.map((v, i) => (deficit > 0 ? max[i] - v : v))
    const roomSum = room.reduce((a, b) => a + b, 0)
    if (roomSum <= 0) break
    vals = vals.map((v, i) => clamp(v + deficit * (room[i] / roomSum), 0, max[i]))
  }
  const out = vals.map((v) => Math.round(v))
  let diff = target - out.reduce((a, b) => a + b, 0)
  const order = criteria.map((_, i) => i).sort(() => rng() - 0.5)
  let guard = 60
  while (diff !== 0 && guard-- > 0) {
    for (const i of order) {
      if (diff > 0 && out[i] < max[i]) {
        out[i]++
        diff--
      } else if (diff < 0 && out[i] > 0) {
        out[i]--
        diff++
      }
      if (diff === 0) break
    }
  }
  return Object.fromEntries(criteria.map((c, i) => [c.id, out[i]]))
}

/**
 * 순위 → 서식1 점수표 초안. 과목의 출판사·평가기준을 그대로 받는다(문서 스냅샷 기준).
 *
 * settings.jitter 가 켜져 있으면(기본) 교사·과목·출판사마다 다른 시드로
 *  - 교사 성향(후함/엄격) 편차 ±3
 *  - 순위별 총점 간격 3~9점(순위 밖은 3~10점)을 무작위로 두고
 *  - 기준별 배분도 비례가 아니라 흩뿌려서
 * 여러 위원의 표를 모아 봐도 간격과 숫자가 일정해 보이지 않게 한다.
 * 순위 간 총점 순서(1위 > 2위 > 3위 > 그 외)는 항상 유지된다.
 * jitter 가 꺼져 있으면 설정된 목표 총점을 배점 비례로 정확히 나눈다.
 */
export function buildDraftScores(
  settings: Settings,
  criteria: Criterion[],
  publishers: DocPublisher[],
  ev: Pick<Evaluation, 'subjectId' | 'teacherName' | 'ranks'>,
): Evaluation['scores'] {
  const t = settings.targetScores
  const vary = settings.jitter
  const scores: Evaluation['scores'] = {}

  if (!vary) {
    for (const p of publishers) {
      scores[p.id] = draftScores(criteria, targetFor(settings, ev.ranks.indexOf(p.id)))
    }
    return scores
  }

  // 교사·과목 단위 시드: 같은 사람이 같은 과목을 다시 만들면 같은 초안, 다른 사람은 다른 초안
  const rng = seededRand(hashStr(`${ev.teacherName}|${ev.subjectId}`))
  const bias = randInt(rng, -3, 3)
  const t1 = clamp(t.r1 + bias + randInt(rng, -2, 3), 60, 100)
  const t2 = clamp(t1 - randInt(rng, 3, 9), 50, t1 - 2)
  const t3 = clamp(t2 - randInt(rng, 3, 9), 45, t2 - 2)

  for (const p of publishers) {
    const rankIdx = ev.ranks.indexOf(p.id)
    let target: number
    if (rankIdx === 0) target = t1
    else if (rankIdx === 1) target = t2
    else if (rankIdx === 2) target = t3
    else target = clamp(t3 - randInt(rng, 3, 10), 40, t3 - 2) // 순위 밖은 출판사마다 다르게
    const prng = seededRand(hashStr(`${ev.teacherName}|${ev.subjectId}|${p.id}`))
    scores[p.id] = distributeNatural(criteria, target, prng)
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

export interface ScoreEditCheck {
  ok: boolean
  /** 이 칸에 넣을 수 있는 가장 낮은 점수 */
  min: number
  /** 이 칸에 넣을 수 있는 가장 높은 점수 (min 보다 작으면 이 칸만으로는 맞출 수 없다) */
  max: number
  /** 넣으려던 값에서 가장 가까운 허용값 (없으면 null) */
  suggestion: number | null
  /** 안내 창에 그대로 보여 줄 문장들 */
  lines: string[]
}

/**
 * 손으로 고친 점수가 서류를 깨뜨리지 않는지 본다.
 *
 * · 칸마다 0 ~ 그 기준의 배점 (그래야 합계도 총배점을 넘지 않는다)
 * · 1순위 > 2순위 > 3순위 > 순위 밖 순서로 합계가 유지되어야 한다.
 *   동점이면 서류만 보고 어느 쪽이 위인지 알 수 없으므로 동점도 막는다.
 */
export function checkScoreEdit(ev: Evaluation, pubId: string, critId: string, value: number): ScoreEditCheck {
  const crit = ev.criteria.find((c) => c.id === critId)
  if (!crit) return { ok: true, min: 0, max: 0, suggestion: value, lines: [] }

  const cap = crit.points
  const nameOf = (id: string) => ev.publishers.find((p) => p.id === id)?.name || '다른 출판사'
  const totalOf = (id: string) => columnTotal(ev.scores[id], ev.criteria)
  const rankWord = (id: string) => {
    const i = ev.ranks.indexOf(id)
    return i >= 0 ? `${i + 1}순위` : '순위에 없는'
  }
  /** 이 칸을 뺀 나머지 합계 */
  const rest = totalOf(pubId) - (Number(ev.scores[pubId]?.[critId]) || 0)

  const ranked = ev.ranks.filter((id): id is string => !!id && ev.publishers.some((p) => p.id === id))
  const idx = ranked.indexOf(pubId)
  const unranked = ev.publishers.filter((p) => !ranked.includes(p.id)).map((p) => p.id)

  let loTotal = 0
  let hiTotal = Number.POSITIVE_INFINITY
  /** 이 출판사보다 낮아야 한다 */
  let above: string | null = null
  /** 이 출판사보다 높아야 한다 */
  let below: string | null = null

  if (idx >= 0) {
    if (idx > 0) {
      above = ranked[idx - 1]
      hiTotal = totalOf(above) - 1
    }
    if (idx < ranked.length - 1) {
      below = ranked[idx + 1]
      loTotal = totalOf(below) + 1
    } else if (unranked.length) {
      // 마지막 순위는 순위에 없는 출판사들보다 높아야 한다
      below = unranked.reduce((best, id) => (totalOf(id) > totalOf(best) ? id : best), unranked[0])
      loTotal = totalOf(below) + 1
    }
  } else if (ranked.length) {
    // 순위에 없는 출판사는 가장 낮은 순위보다 낮아야 한다
    above = ranked[ranked.length - 1]
    hiTotal = totalOf(above) - 1
  }

  const min = Math.max(0, loTotal - rest)
  const max = Math.min(cap, hiTotal - rest)
  if (value >= min && value <= max) return { ok: true, min, max, suggestion: value, lines: [] }

  const lines: string[] = []
  if (value > cap) lines.push(`이 항목의 배점은 ${cap}점입니다. 그보다 높은 점수는 넣을 수 없습니다.`)
  if (above) lines.push(`${nameOf(pubId)}의 합계는 ${rankWord(above)} ${nameOf(above)}(${totalOf(above)}점)보다 낮아야 합니다.`)
  if (below) lines.push(`${nameOf(pubId)}의 합계는 ${rankWord(below)} ${nameOf(below)}(${totalOf(below)}점)보다 높아야 합니다.`)
  if (min <= max) lines.push(`이 칸에는 ${min}~${max}점을 넣을 수 있습니다.`)
  else lines.push('이 칸만으로는 순위를 지킬 수 없습니다. 다른 칸의 점수를 먼저 조정해 주세요.')

  return { ok: false, min, max, suggestion: min <= max ? Math.max(min, Math.min(max, value)) : null, lines }
}
