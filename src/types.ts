export type GradeGroup = '1·2' | '3'
export type Tone = 'formal' | 'plain' // formal: ~함/~됨 (개조식), plain: ~합니다 (서술식)

export interface Subject {
  id: string
  name: string
  gradeGroup: GradeGroup
  subjectGroup: string
  status: 'open' | 'closed'
}

export interface Publisher {
  id: string
  subjectId: string
  name: string
  order: number
  price?: string
  memo?: string
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

export interface CommitteeMember {
  id: string
  subjectId: string
  teacherName: string
  role: 'member' | 'lead' | 'compiler'
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
  accessCode: string
  compilerCode: string
  adminCode: string
  aiModel: string
  aiFallbackModel: string
  aiMaxPerDoc: number
}

export interface Master {
  version: number
  settings: Settings
  subjects: Subject[]
  publishers: Publisher[]
  criteria: Criterion[]
  opinionOptions: OpinionOption[]
  committee: CommitteeMember[]
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

export type MemberStatus = 'pending' | 'approved' | 'rejected'
export type MemberRole = 'member' | 'admin'

/** 구글 로그인 사용자. 관리자가 승인해야 앱을 쓸 수 있다. */
export interface Member {
  uid: string
  email: string
  /** 로그인 후 본인이 입력한 이름. 서식의 위원명으로 쓰인다. */
  displayName: string
  role: MemberRole
  status: MemberStatus
  requestedAt: string
  decidedAt?: string
  note?: string
}

export interface Evaluation {
  id: string
  subjectId: string
  teacherName: string
  /** 로그인 모드에서 제출자 식별 (규칙에서 본인 문서만 수정 허용) */
  uid?: string
  pinHash?: string
  ranks: (string | null)[] // 1,2,3순위 pubId
  scores: Record<string, Record<string, number>> // pubId -> criterionId -> score
  summaryKeys: string[]
  summaryOpinion: string
  recommend: RecommendItem[]
  status: 'draft' | 'submitted'
  aiCount: number
  submittedAt?: string
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

export interface Summary {
  id: string
  subjectId: string
  memberColumns: { teacherName: string; evaluationId: string }[]
  matrix: Record<string, Record<string, number>> // pubId -> evaluationId -> total
  writer: Person
  checker: Person
  recommendDoc: SummaryRecommend[]
  recommendWriter: Person
  recommendChecker: Person
  status: 'draft' | 'finalized'
  aiCount: number
  finalizedAt?: string
  updatedAt: string
}

export interface FirebaseConfig {
  apiKey?: string
  authDomain?: string
  projectId?: string
  appId?: string
  /** 컬렉션 이름 (기본 docs). 기존 Firebase 프로젝트를 여러 앱이 공유할 때 앱별로 다르게 지정 */
  collection?: string
  /** App Check: 등록된 사이트에서 온 요청만 Firestore에 통과시킴 */
  appCheck?: AppCheckConfig
}

export interface AppCheckConfig {
  /** reCAPTCHA 종류. 신규 등록은 enterprise 권장 */
  provider?: 'enterprise' | 'v3'
  /** reCAPTCHA 사이트 키(공개 값). 비어 있으면 App Check를 켜지 않음 */
  siteKey?: string
  /** localhost 개발용 디버그 토큰. 배포본에서는 무시됨 */
  debugToken?: string
}

export interface AppConfig {
  schoolName?: string
  year?: number
  supabaseUrl?: string
  supabaseAnonKey?: string
  /** 테이블 이름 (기본 docs) */
  supabaseTable?: string
  firebase?: FirebaseConfig
}
