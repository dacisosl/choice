export type GradeGroup = '1·2' | '3'
export type Tone = 'formal' | 'plain' // formal: ~함/~됨 (개조식), plain: ~합니다 (서술식)

export interface Subject {
  id: string
  name: string
  gradeGroup: GradeGroup
  subjectGroup: string
  /** catalog = 앱에 실려 온 교과서 자료(public/catalog.json). 없으면 이 컴퓨터에서 직접 넣은 것 */
  source?: 'catalog'
}

export interface Publisher {
  id: string
  subjectId: string
  name: string
  order: number
  price?: string
  memo?: string
  /** catalog = 앱에 실려 온 교과서 자료(public/catalog.json) */
  source?: 'catalog'
}

export interface Criterion {
  id: string
  /** null = 기본 템플릿 */
  subjectId: string | null
  area: string
  text: string
  points: number
  locked: boolean
  order: number
}

export interface OpinionOption {
  id: string
  scope: 'summary' | 'recommend'
  category: string
  label: string
  /** null = 공통 */
  subjectGroup: string | null
  order: number
  negative?: boolean
}

export interface Settings {
  schoolName: string
  year: number
  tone: Tone
  targetScores: { r1: number; r2: number; r3: number; other: number }
  jitter: boolean
  memberHeaderMode: 'name' | 'number'
  printPersonalRecommend: boolean
  averageDecimals: number
}

/** 과목·출판사·평가기준·의견 선택지·설정. 모두 이 컴퓨터(localStorage)에만 있다 */
export interface Master {
  version: number
  settings: Settings
  subjects: Subject[]
  publishers: Publisher[]
  criteria: Criterion[]
  opinionOptions: OpinionOption[]
  updatedAt: string
}

export type RecommendStrength = '적극 추천' | '추천' | '대안으로 추천'

export interface RecommendItem {
  rank: 1 | 2 | 3
  pubId: string | null
  keys: string[]
  strength: RecommendStrength
  text: string
}

/** 문서 안에서만 쓰는 출판사 스냅샷 (마스터와 무관하게 해석 가능) */
export interface DocPublisher {
  id: string
  name: string
}

/**
 * 위원 개인 평가표(서식1 + 개인 서식3). 이 컴퓨터에만 저장되며 PDF/JSON으로만 전달된다.
 * 다른 컴퓨터에서도 해석되도록 과목명·출판사·평가기준을 스냅샷으로 품고 있다.
 */
export interface Evaluation {
  id: string
  subjectId: string
  subjectName: string
  teacherName: string
  publishers: DocPublisher[]
  criteria: Criterion[]
  ranks: (string | null)[] // 1,2,3순위 pubId
  scores: Record<string, Record<string, number>> // pubId -> criterionId -> score
  summaryKeys: string[]
  summaryOpinion: string
  recommend: RecommendItem[]
  updatedAt: string
}

export interface Person {
  position: string
  name: string
}

export interface SummaryRecommend {
  rank: 1 | 2 | 3
  pubId: string | null
  text: string
}

export type MemberSource = 'pdf' | 'pdf-ocr' | 'json' | 'manual'

/** 총괄표의 위원 열 하나. PDF/JSON에서 읽은 원본 문서를 함께 보관한다 */
export interface SummaryMember {
  id: string
  teacherName: string
  source: MemberSource
  evaluation?: Evaluation
  warnings: string[]
}

/** 과목별 총괄표(서식2 + 공식 서식3). 총괄 교사의 컴퓨터에만 저장된다 */
export interface Summary {
  id: string
  subjectId: string
  subjectName: string
  publishers: DocPublisher[]
  members: SummaryMember[]
  matrix: Record<string, Record<string, number>> // pubId -> memberId -> total
  writer: Person
  checker: Person
  recommendDoc: SummaryRecommend[]
  recommendWriter: Person
  recommendChecker: Person
  updatedAt: string
}

/** public/catalog.json — 과목별 교과서(출판사) 자료. 앱과 함께 배포된다 */
export interface CatalogSubject {
  /** 비우면 과목명으로 자동 생성한다 */
  id?: string
  name: string
  gradeGroup?: GradeGroup
  /** 교과(예: 사회). 의견 문장 고를 때 참고한다 */
  subjectGroup?: string
  /** 출판사명 목록. "비상교육" 또는 { name, price } 둘 다 된다 */
  publishers: (string | { name: string; price?: string })[]
}

export interface Catalog {
  /** 자료 갱신일(예: 2026-09-13). 값이 바뀌면 각 컴퓨터의 목록을 새로 받아 간다 */
  updatedAt?: string
  year?: number
  subjects: CatalogSubject[]
}

export interface AppConfig {
  schoolName?: string
  year?: number
}
