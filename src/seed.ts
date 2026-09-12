import type { Criterion, Master, OpinionOption, Settings, Subject } from './types'

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

const SUBJECT_TABLE: [string, string, string[]][] = [
  ['1·2', '과학', ['생태와 환경']],
  ['1·2', '정보', ['인공지능 기초']],
  ['1·2', '기술·가정', ['창의 공학 설계', '로봇과 공학세계']],
  ['1·2', '사회', ['동아시아 역사 기행', '세계사']],
  ['1·2', '수학', ['인공지능 수학']],
  ['3', '국어', ['문학과 영상', '언어생활 탐구', '주제 탐구 독서', '화법과 언어']],
  ['3', '수학', ['미적분Ⅱ', '수학 과제 탐구', '확률과 통계']],
  ['3', '영어', ['미디어 영어', '심화 영어', '영미 문학 읽기', '영어 독해와 작문']],
  [
    '3',
    '사회',
    [
      '국제 관계의 이해',
      '금융과 경제생활',
      '도시의 미래 탐구',
      '사회문제 탐구',
      '역사로 탐구하는 현대 세계',
      '여행지리',
      '윤리문제 탐구',
      '인문학과 윤리',
      '정치',
    ],
  ],
  [
    '3',
    '과학',
    [
      '과학의 역사와 문화',
      '기후변화와 환경생태',
      '생물의 유전',
      '융합과학 탐구',
      '전자기와 양자',
      '화학 반응의 세계',
      '행성우주과학',
    ],
  ],
  ['3', '체육', ['스포츠 생활1', '스포츠 생활2']],
  ['3', '음악', ['음악 감상과 비평', '음악 연주와 창작']],
  ['3', '미술', ['미술 감상과 비평', '미술 창작']],
  ['3', '기술·가정', ['발명과 디자인', '생활과학 탐구']],
  ['3', '정보', ['데이터 과학', '소프트웨어와 생활']],
  ['3', '제2외국어', ['일본 문화', '일본어 회화', '중국 문화', '중국어 회화']],
]

/** 계획서에 실린 선정 대상 과목 예시. 설정 화면에서 불러와 쓸 수 있다 */
export function seedSubjects(): Subject[] {
  const out: Subject[] = []
  let i = 0
  for (const [grade, group, names] of SUBJECT_TABLE) {
    for (const name of names) {
      i++
      out.push({
        id: `sub-${String(i).padStart(2, '0')}`,
        name,
        gradeGroup: grade as Subject['gradeGroup'],
        subjectGroup: group,
      })
    }
  }
  return out
}

export const DEFAULT_CRITERIA: Omit<Criterion, 'id' | 'subjectId'>[] = [
  { area: '교육과정 적합성', text: '2022 개정 교육과정 성취기준 반영 및 내용의 타당성', points: 25, locked: false, order: 1 },
  { area: '내용의 선정·조직', text: '학생 수준·흥미에 맞는 내용 선정과 체계적 구성', points: 25, locked: false, order: 2 },
  { area: '교수·학습 및 평가', text: '탐구·활동 과제, 자기주도학습 및 평가 자료의 적절성', points: 20, locked: false, order: 3 },
  { area: '표현·표기 및 편집', text: '문장·용어의 정확성, 삽화·디자인·가독성', points: 15, locked: false, order: 4 },
  { area: '가격 및 재정 (필수)', text: '정가의 적정성, 전년 대비 증감 및 동일 과목 타 도서와의 비교', points: 15, locked: true, order: 5 },
]

export function seedCriteria(): Criterion[] {
  return DEFAULT_CRITERIA.map((c, i) => ({ ...c, id: `crit-default-${i + 1}`, subjectId: null }))
}

const SUMMARY_OPTIONS: [string, string[]][] = [
  ['교육과정', ['성취기준 충실 반영', '핵심 개념 체계적', '교과 역량 연계 우수']],
  ['내용 구성', ['학생 수준 적합', '난이도 단계적', '실생활 사례 풍부', '최신 자료 반영']],
  ['교수·학습', ['탐구활동 다양', '프로젝트·협력학습 구성', '자기주도학습 지원', '디지털 자료 연계']],
  ['평가', ['형성평가 자료 충실', '서·논술형 평가 연계', '과정중심평가 용이']],
  ['편집·가독성', ['삽화·도표 명확', '편집 깔끔', '용어 정의 정확']],
  ['가격·재정', ['가격 적정', '전년 대비 부담 완화', '타 도서 대비 합리적']],
  ['학교 여건', ['본교 학생 수준에 부합', '기존 수업 자료와 연계 용이', '진로 연계 우수']],
]
const NEGATIVE_OPTIONS = ['분량 과다', '활동 난이도 높음', '삽화 부족', '가격 높음']

export function seedOpinionOptions(): OpinionOption[] {
  const out: OpinionOption[] = []
  let order = 0
  for (const scope of ['summary', 'recommend'] as const) {
    for (const [category, labels] of SUMMARY_OPTIONS) {
      for (const label of labels) {
        order++
        out.push({ id: `opt-${scope}-${order}`, scope, category, label, subjectGroup: null, order })
      }
    }
    for (const label of NEGATIVE_OPTIONS) {
      order++
      out.push({ id: `opt-${scope}-${order}`, scope, category: '아쉬운 점', label, subjectGroup: null, order, negative: true })
    }
    order++
    out.push({ id: `opt-${scope}-${order}`, scope, category: '교과 전용', label: '원어민 음원·발음 자료 우수', subjectGroup: '영어', order })
  }
  return out
}

export const DEFAULT_SETTINGS: Settings = {
  schoolName: '해밀고등학교',
  year: 2027,
  tone: 'formal',
  targetScores: { r1: 92, r2: 86, r3: 80, other: 72 },
  jitter: true,
  memberHeaderMode: 'name',
  printPersonalRecommend: true,
  averageDecimals: 1,
  aiModel: 'openai/gpt-4o-mini',
  aiFallbackModel: 'google/gemini-flash-1.5',
  aiMaxPerDoc: 10,
}

export function seedMaster(overrides?: Partial<Settings>): Master {
  return {
    version: 3,
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    subjects: [],
    publishers: [],
    criteria: seedCriteria(),
    opinionOptions: seedOpinionOptions(),
    updatedAt: new Date().toISOString(),
  }
}

/** 테스트용 예시 출판사 (실제 출판사 목록은 관리 화면/CSV로 입력) */
export const SAMPLE_PUBLISHERS = ['비상교육', '천재교육', '미래엔', '동아출판', '지학사', '금성출판사', '교학사', 'YBM']
