import type { OpinionOption, RecommendStrength, Tone } from '../types'
import { adnominal, josa } from './josa'

/**
 * 의견 문장 만들기. 고른 핵심의견을 규칙에 따라 문장으로 엮는다.
 * 바깥 서비스를 부르지 않으므로 인터넷 없이도 그대로 동작한다.
 */

export interface GenInput {
  kind: 'summary' | 'recommend' | 'compile'
  subject: string
  publisher?: string
  rank?: number
  positives: string[]
  negatives: string[]
  strength?: RecommendStrength
  tone: Tone
  length: 'short' | 'long'
  avoid?: string[]
  /** 총괄 종합용: 위원들의 개인 의견 */
  sources?: string[]
}

// ───────────── 규칙 기반(오프라인) 문장 ─────────────

const shuffle = <T,>(arr: T[], seed: number): T[] => {
  const a = [...arr]
  let s = seed || 1
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const strHash = (s: string) => {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

/** 핵심의견 → 서술 구절 */
const PHRASES: Record<string, string> = {
  '성취기준 충실 반영': '2022 개정 교육과정의 성취기준을 충실히 반영하고 있',
  '핵심 개념 체계적': '핵심 개념이 체계적으로 조직되어 있',
  '교과 역량 연계 우수': '교과 역량과의 연계가 우수하',
  '학생 수준 적합': '내용의 수준이 학생 발달 단계에 적합하',
  '난이도 단계적': '난이도가 단계적으로 구성되어 학습 부담이 적절하',
  '실생활 사례 풍부': '실생활 사례가 풍부하여 학습 동기를 높이기에 적합하',
  '최신 자료 반영': '최신 자료와 동향이 반영되어 있',
  '탐구활동 다양': '탐구활동이 다양하게 제시되어 있',
  '프로젝트·협력학습 구성': '프로젝트 및 협력학습 활동이 잘 구성되어 있',
  '자기주도학습 지원': '자기주도학습을 지원하는 장치가 충실하',
  '디지털 자료 연계': '디지털 자료와의 연계가 원활하',
  '형성평가 자료 충실': '형성평가 자료가 충실하게 제공되',
  '서·논술형 평가 연계': '서·논술형 평가와의 연계가 용이하',
  '과정중심평가 용이': '과정중심평가를 적용하기에 용이하',
  '삽화·도표 명확': '삽화와 도표가 명확하여 이해를 돕',
  '편집 깔끔': '편집이 깔끔하여 가독성이 높',
  '용어 정의 정확': '용어 정의가 정확하',
  '가격 적정': '정가가 적정한 수준이',
  '전년 대비 부담 완화': '전년 대비 가격 부담이 완화되',
  '타 도서 대비 합리적': '동일 과목 타 도서에 비해 가격이 합리적이',
  '본교 학생 수준에 부합': '본교 학생의 수준과 특성에 부합하',
  '기존 수업 자료와 연계 용이': '기존 수업 자료와의 연계가 용이하',
  '진로 연계 우수': '학생 진로와의 연계가 우수하',
  '원어민 음원·발음 자료 우수': '원어민 음원 및 발음 자료가 우수하',
  '분량 과다': '분량이 다소 많',
  '활동 난이도 높음': '일부 활동의 난이도가 높',
  '삽화 부족': '삽화가 다소 부족하',
  '가격 높음': '가격이 다소 높',
}

function phrase(label: string): string {
  return PHRASES[label] || `${label} 측면이 우수하`
}

function end(tone: Tone, kind: 'state' | 'judge' = 'state'): string {
  if (tone === 'formal') return kind === 'state' ? '음.' : '됨.'
  return kind === 'state' ? '습니다.' : '됩니다.'
}

// 어미 결합: 어간이 '하'로 끝나면 '함/합니다', '이'로 끝나면 '임/입니다' 등 단순 처리
function conj(stem: string, tone: Tone): string {
  const last = stem.slice(-1)
  if (tone === 'formal') {
    if (last === '하') return stem.slice(0, -1) + '함.'
    if (last === '이') return stem.slice(0, -1) + '임.'
    if (last === '되') return stem.slice(0, -1) + '됨.'
    if (last === '있') return stem + '음.'
    if (last === '높') return stem + '음.'
    if (last === '많') return stem + '음.'
    if (last === '돕') return stem.slice(0, -1) + '도움.'
    return stem + '음.'
  }
  if (last === '하') return stem.slice(0, -1) + '합니다.'
  if (last === '이') return stem.slice(0, -1) + '입니다.'
  if (last === '되') return stem.slice(0, -1) + '됩니다.'
  if (last === '있') return stem + '습니다.'
  if (last === '높') return stem + '습니다.'
  if (last === '많') return stem + '습니다.'
  if (last === '돕') return stem + '습니다.'
  return stem + '습니다.'
}

const OPENERS_SUMMARY = [
  (s: string, p: string) => `${p} 교과서는 ${s} 과목의 교육과정 취지에 비추어 볼 때`,
  (s: string, p: string) => `${s} 과목 ${p} 도서를 검토한 결과`,
  (s: string, p: string) => `${p}의 ${s} 교과서는 전반적으로`,
]

/** 고른 핵심의견으로 의견 문장을 만든다 */
export function generateOpinion(input: GenInput): string {
  const seed = strHash(`${input.subject}|${input.publisher}|${input.rank}|${input.positives.join(',')}`)
  const pos = shuffle(input.positives, seed)
  const neg = input.negatives
  const t = input.tone
  const p = input.publisher || '해당'
  const s = input.subject
  const sentences: string[] = []

  if (input.kind === 'compile') {
    const rankTxt = input.rank ? `${input.rank}순위` : ''
    sentences.push(
      t === 'formal'
        ? `교과협의회 위원들의 개별 평가 결과를 종합하여 ${p}${josa(p, '을')} ${rankTxt}로 추천함.`
        : `교과협의회 위원들의 개별 평가 결과를 종합하여 ${p}${josa(p, '을')} ${rankTxt}로 추천합니다.`,
    )
    const srcs = (input.sources || []).filter(Boolean)
    if (srcs.length) {
      const merged = srcs
        .join(' ')
        .split(/(?<=[.。])\s+/)
        .map((x) => x.trim())
        .filter(Boolean)
      const uniq = Array.from(new Set(merged)).slice(0, input.length === 'long' ? 5 : 3)
      sentences.push(...uniq)
    }
    if (pos.length) sentences.push(conj(`위원 공통 의견으로 ${pos.slice(0, 3).map(phrase).join('고, ')}`, t))
    return sentences.join(' ')
  }

  const opener = OPENERS_SUMMARY[seed % OPENERS_SUMMARY.length](s, p)
  if (pos.length === 0 && neg.length === 0) {
    return conj(`${opener} 전반적으로 검토 결과가 양호하`, t)
  }
  const chunk = input.length === 'long' ? 2 : 3
  const groups: string[][] = []
  for (let i = 0; i < pos.length; i += chunk) groups.push(pos.slice(i, i + chunk))
  groups.forEach((g, i) => {
    const body = g.map(phrase).join('고, ')
    if (i === 0) sentences.push(conj(`${opener} ${body}`, t))
    else if (i === 1) sentences.push(conj(`또한 ${body}`, t))
    else sentences.push(conj(`아울러 ${body}`, t))
  })
  if (neg.length) {
    const body = adnominal(neg.map(phrase).join('고, '))
    sentences.push(t === 'formal' ? `다만 ${body} 점은 보완이 필요함.` : `다만 ${body} 점은 보완이 필요합니다.`)
  }
  if (input.kind === 'recommend') {
    const st = input.strength || '추천'
    const rk = input.rank ? `${input.rank}순위로` : ''
    const verb =
      st === '적극 추천' ? '적극 추천하' : st === '대안으로 추천' ? '대안으로 추천하' : '추천하'
    sentences.push(conj(`이상의 사유로 ${p}${josa(p, '을')} ${rk} ${verb}`.replace(/\s+/g, ' '), t))
  } else if (input.rank) {
    sentences.push(conj(`종합적으로 ${input.rank}순위로 평가하`, t))
  }
  return sentences.join(' ')
}

export function splitKeys(options: OpinionOption[], keys: string[]): { positives: string[]; negatives: string[] } {
  const positives: string[] = []
  const negatives: string[] = []
  for (const k of keys) {
    const o = options.find((x) => x.id === k)
    if (!o) continue
    ;(o.negative ? negatives : positives).push(o.label)
  }
  return { positives, negatives }
}
