import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SHOT = (f: string) => `${import.meta.env.BASE_URL}guide/${f}`

interface Slide {
  id: string
  /** 위쪽에 붙는 묶음 이름 */
  section: string
  /** '1단계' 처럼 짧은 표시 (없으면 안 나온다) */
  step?: string
  title: string
  lead: string
  points: string[]
  tip?: string
  img?: string
  alt?: string
  kind?: 'intro' | 'outro'
}

/** 핵심 요약 (첫 장) */
const HIGHLIGHTS: { icon: string; title: string; body: string }[] = [
  {
    icon: '🔒',
    title: '로그인 없음 · API 키 없음',
    body: '가입도, 계정도, 인증키도 필요 없습니다. 작성한 내용이 밖으로 나가지 않으니 유출 걱정이 없습니다.',
  },
  {
    icon: '💾',
    title: '내 컴퓨터에만 저장',
    body: '평가표와 총괄표는 쓰는 사람의 브라우저에만 남습니다. 서버에 올라가지 않고, 인터넷이 끊겨도 이어서 쓸 수 있습니다.',
  },
  {
    icon: '📚',
    title: '과목 · 발행사 미리 입력',
    body: '올해 웹전시 목록 기준으로 중·고등학교 552개 과목과 발행사 80곳이 이미 들어 있습니다. 과목만 고르면 발행사가 따라옵니다.',
  },
]

/** 그 밖에 알아 두면 좋은 점 (마지막 장) */
const EXTRAS: { icon: string; title: string; body: string }[] = [
  { icon: '✍️', title: '순위만 정하면 초안 완성', body: '1~3순위를 고르면 항목별 점수와 종합의견 문장이 한 번에 만들어집니다.' },
  { icon: '🛡️', title: '계산 실수는 아예 차단', body: '배점 초과, 순위 뒤바뀜, 동점은 입력 단계에서 막고 넣을 수 있는 범위를 알려 줍니다.' },
  { icon: '📄', title: '총괄표는 PDF만 올리면 끝', body: '합쳐서 보낸 파일이든 위원별 파일이든, 빈 페이지가 섞여 있어도 읽어 냅니다.' },
  { icon: '🖨️', title: '서식 그대로 인쇄', body: '평가표는 가로 1쪽, 추천 의견서는 세로 1쪽으로 각각 저장됩니다.' },
  { icon: '📱', title: '휴대전화에서도 작성', body: '설치할 것이 없습니다. 주소만 열면 휴대전화·태블릿에서도 같은 화면을 씁니다.' },
  { icon: '🧾', title: '빠진 과목은 직접 추가', body: '목록에 없는 과목·발행사는 작성 화면이나 [설정]에서 바로 넣어 쓸 수 있습니다.' },
]

const SLIDES: Slide[] = [
  {
    id: 'intro',
    section: '',
    kind: 'intro',
    title: '교과서 선정 서류, 초안부터 간편하게',
    lead: '선정 평가표 · 추천 의견서 · 평가총괄표를 몇 번의 클릭으로 만듭니다. 먼저 이 앱의 세 가지 약속을 봐 주세요.',
    points: [],
    tip: '아래 [다음]을 누르면 실제 화면으로 사용법을 하나씩 따라갈 수 있습니다.',
  },
  {
    id: 'start',
    section: '서류 초안 작성하기',
    step: '1단계',
    title: '시작 화면에서 [서류 초안 작성하기]',
    lead: '교과 위원이라면 큰 초록 버튼을, 총괄표를 맡았다면 그 아래 [평가총괄표 작성]을 누릅니다.',
    points: ['가입·로그인 화면이 없습니다. 누르면 바로 작성 화면입니다.', '오른쪽 위 [설정]에서는 평가기준과 교과서 자료를 볼 수 있습니다.'],
    img: '01-start.jpg',
    alt: '앱 첫 화면과 [서류 초안 작성하기] 버튼',
  },
  {
    id: 'search',
    section: '서류 초안 작성하기',
    step: '2단계',
    title: '이름을 적고 학교급을 고른 뒤 과목을 찾습니다',
    lead: '[중학교] 또는 [고등학교]를 먼저 누르면 그 학교급 과목만 찾습니다. 과목 칸에 두어 글자만 쳐도 후보가 바로 뜹니다.',
    points: [
      "'확률' 처럼 일부만 쳐도 됩니다. 띄어쓰기는 신경 쓰지 않아도 됩니다.",
      "초성도 됩니다. 'ㅎㄹㄱㅌㄱ' → 확률과 통계.",
      '교과(군) 이름으로도 찾습니다. 예: 수학, 사회.',
    ],
    tip: '후보에서 ↑ ↓ 로 옮기고 Enter 로 고를 수 있습니다.',
    img: '02-search.jpg',
    alt: "과목 칸에 '확률' 을 입력하니 '확률과 통계' 후보가 뜬 화면",
  },
  {
    id: 'publishers',
    section: '서류 초안 작성하기',
    step: '3단계',
    title: '과목을 고르면 발행사가 저절로 채워집니다',
    lead: '올해 웹전시 목록에 실린 그 과목의 발행사가 순서대로 들어옵니다. 손으로 하나씩 적을 필요가 없습니다.',
    points: [
      '우리 학교가 보지 않는 발행사는 옆의 ✕ 로 빼면 됩니다.',
      '목록에 없는 발행사는 맨 아래 칸에 직접 적어 넣을 수 있습니다.',
      '과목을 잘못 골랐다면 [바꾸기] 로 다시 찾습니다.',
    ],
    img: '03-publishers.jpg',
    alt: '과목을 고르자 발행사 목록이 자동으로 채워진 화면',
  },
  {
    id: 'sheet',
    section: '서류 초안 작성하기',
    step: '4단계',
    title: '1~3순위만 고르면 평가표가 완성됩니다',
    lead: '순위를 고른 순간 항목별 점수가 채워지고 합계·순위가 서식 그대로 그려집니다.',
    points: [
      '점수는 순위에 맞게, 위원마다 조금씩 다르게 만들어집니다.',
      '합계는 항상 총배점(기본 100점) 안에서 계산됩니다.',
      '평가기준·배점을 학교 양식에 맞게 바꾸려면 [설정] → [평가기준].',
    ],
    tip: '빨간 글씨 그대로, 자동으로 만든 초안입니다. 반드시 검토한 뒤 쓰세요.',
    img: '04-sheet.jpg',
    alt: '순위를 고르자 점수가 채워진 선정 평가표',
  },
  {
    id: 'guard',
    section: '서류 초안 작성하기',
    step: '5단계',
    title: '점수는 칸을 눌러 바로 고칩니다',
    lead: '숫자 칸을 눌러 고치면 됩니다. 다만 서류가 틀어질 만한 값은 앱이 먼저 막아 줍니다.',
    points: [
      '항목 배점을 넘는 점수는 들어가지 않습니다.',
      '2순위가 1순위보다 높아지거나 동점이 되는 수정도 막습니다.',
      '넣을 수 있는 범위를 알려 주고, 누르면 가장 가까운 값으로 고쳐 줍니다.',
    ],
    tip: '순위와 점수가 어긋나면 총괄표까지 틀어집니다. 이 창이 그것을 미리 막아 줍니다.',
    img: '05-guard.jpg',
    alt: '허용 범위를 벗어난 점수를 넣자 안내 창이 뜬 화면',
  },
  {
    id: 'opinion',
    section: '서류 초안 작성하기',
    step: '6단계',
    title: '종합의견은 체크만 하면 문장이 됩니다',
    lead: '표 맨 아래 종합의견 칸을 누르면 창이 열립니다. 해당하는 항목에 체크하면 문장이 만들어집니다.',
    points: [
      '교육과정·내용 구성·교수학습·평가·편집 등에서 골라 체크합니다.',
      '아쉬운 점도 함께 고를 수 있어 한쪽으로 치우치지 않습니다.',
      '문장 길이(2~4문장 등)를 고르고 [다시 생성] 으로 표현을 바꿉니다.',
      '만들어진 문장은 그 자리에서 직접 손볼 수 있습니다.',
    ],
    tip: '문장은 앱 안에서 만들어집니다. 외부 서비스로 내용을 보내지 않습니다.',
    img: '06-opinion.jpg',
    alt: '핵심의견을 체크하자 종합의견 문장이 만들어진 창',
  },
  {
    id: 'form3',
    section: '서류 초안 작성하기',
    step: '7단계',
    title: '추천 의견서도 이어서 만들어집니다',
    lead: '[다음: 추천 의견서] 를 누르면 1~3순위와 추천 사유가 적힌 서식이 나옵니다.',
    points: ['평가표에서 정한 순위가 그대로 옮겨집니다.', '사유 문장은 칸을 눌러 바로 고칠 수 있습니다.'],
    img: '07-form3.jpg',
    alt: '순위와 추천 사유가 채워진 추천 의견서',
  },
  {
    id: 'print',
    section: '서류 초안 작성하기',
    step: '8단계',
    title: '평가표와 의견서를 따로따로 저장합니다',
    lead: '마지막 [인쇄·저장] 단계에서 두 버튼이 나옵니다. 총괄 선생님께 보낼 파일이 서식별로 깔끔하게 나뉩니다.',
    points: [
      '[평가표 인쇄·PDF] → 가로 1쪽.',
      '[추천 의견서 인쇄·PDF] → 세로 1쪽.',
      "인쇄 창에서 프린터를 'PDF로 저장' 으로 고르면 파일이 됩니다.",
      '이 화면에서도 점수·의견을 그대로 고칠 수 있습니다.',
    ],
    tip: '빈 페이지 없이 딱 한 쪽씩 나옵니다.',
    img: '08-print.jpg',
    alt: '평가표 인쇄와 추천 의견서 인쇄 버튼이 있는 인쇄·저장 화면',
  },
  {
    id: 'printnotice',
    section: '서류 초안 작성하기',
    step: '9단계',
    title: '인쇄 전 마지막 확인',
    lead: '인쇄를 누르면 확인 창이 한 번 뜹니다. 제출 전에 꼭 짚어야 할 것을 알려 줍니다.',
    points: ['이 서류의 최종 책임은 작성자 본인에게 있습니다.', '자동으로 만든 초안이므로 점수와 문장을 확인한 뒤 제출합니다.', '이름·과목·발행사·순위가 맞는지 다시 봅니다.'],
    img: '09-printnotice.jpg',
    alt: '인쇄 전에 뜨는 확인 안내 창',
  },
  {
    id: 'compile-upload',
    section: '평가총괄표 만들기',
    step: '1단계',
    title: '위원들이 보낸 평가표 PDF를 올립니다',
    lead: '시작 화면에서 [평가총괄표 작성] 으로 들어와, 끌어다 놓거나 [+ 추가하기] 로 파일을 고릅니다.',
    points: [
      '여러 위원의 평가표를 한 파일로 합쳐 올려도 됩니다.',
      '위원별로 따로 올려도 됩니다. 섞어서 올려도 괜찮습니다.',
      '중간에 빈 페이지나 스캔이 흐린 장이 있어도 그 장만 건너뜁니다.',
    ],
    tip: '추천 의견서가 함께 들어 있으면 작성자 이름을 보고 알아서 짝지어 줍니다.',
    img: '10-compile-upload.jpg',
    alt: '평가표 PDF를 올리는 총괄표 첫 화면',
  },
  {
    id: 'compile-members',
    section: '평가총괄표 만들기',
    step: '2단계',
    title: '위원 이름과 점수를 읽어 옵니다',
    lead: '파일에서 위원명·발행사·점수를 뽑아 목록으로 보여 줍니다. 확인할 점이 있으면 함께 알려 줍니다.',
    points: ['잘못 들어온 파일은 [삭제] 로 빼면 됩니다.', 'PDF가 없는 위원은 [위원 직접 추가] 로 손으로 넣을 수 있습니다.', '다 모였으면 [총괄표 생성하기].'],
    img: '11-compile-members.jpg',
    alt: '위원 3명의 평가표를 읽어 목록으로 보여 주는 화면',
  },
  {
    id: 'compile-sheet',
    section: '평가총괄표 만들기',
    step: '3단계',
    title: '총괄표를 확인하고 인쇄합니다',
    lead: '위원별 점수, 합계와 평균, 최종 순위가 서식 그대로 계산됩니다.',
    points: ['숫자 칸은 눌러서 고칠 수 있습니다(총배점을 넘지 않게 막아 줍니다).', '평가총괄표와 추천 의견서를 각각 인쇄·저장합니다.'],
    tip: '자동 계산 결과입니다. 인쇄 전에 원본과 한 번 대조해 주세요.',
    img: '12-compile-sheet.jpg',
    alt: '위원별 점수와 평균, 순위가 계산된 평가총괄표',
  },
  {
    id: 'settings',
    section: '그 밖에',
    title: '교과서 자료와 평가기준은 [설정] 에서',
    lead: '어떤 자료가 들어 있는지, 갱신일이 언제인지 한눈에 볼 수 있습니다.',
    points: [
      '과목 552개 · 발행사 80곳(등록 1,291건)이 들어 있습니다.',
      '목록에 없는 과목·발행사는 여기서 직접 넣어 둘 수 있습니다.',
      '평가영역·평가기준·배점도 학교 양식에 맞게 고칩니다.',
    ],
    tip: '자료가 새로 올라오면 [자료 다시 불러오기] 한 번이면 됩니다. 직접 넣은 항목은 지워지지 않습니다.',
    img: '13-settings.jpg',
    alt: '교과서 자료의 과목 수와 갱신일을 보여 주는 설정 화면',
  },
  {
    id: 'mobile',
    section: '그 밖에',
    title: '휴대전화에서도 그대로 작성합니다',
    lead: '좁은 화면에서는 입력 칸이 접혔다 펴지고, 서식은 손가락으로 밀어 보면 됩니다.',
    points: ['설치할 앱이 없습니다. 주소만 열면 됩니다.', '작성하던 내용은 그 기기에 남아 있어 이어서 쓸 수 있습니다.'],
    img: '14-mobile.jpg',
    alt: '휴대전화 크기 화면에서 본 작성 화면',
  },
  {
    id: 'outro',
    section: '',
    kind: 'outro',
    title: '이 정도만 알면 충분합니다',
    lead: '아래 내용도 알아 두면 더 빨리 끝납니다.',
    points: [],
  },
]

export function Guide({ go }: { go: (h: string) => void }) {
  const [i, setI] = useState(0)
  const [zoom, setZoom] = useState<string | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const last = SLIDES.length - 1
  const s = SLIDES[i]

  const move = useCallback((n: number) => setI((v) => Math.min(last, Math.max(0, n))), [last])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (zoom) {
        if (e.key === 'Escape') setZoom(null)
        return
      }
      if (e.key === 'ArrowRight') move(i + 1)
      else if (e.key === 'ArrowLeft') move(i - 1)
      else if (e.key === 'Home') move(0)
      else if (e.key === 'End') move(last)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [i, last, move, zoom])

  // 화면이 바뀌면 위쪽부터 보이게, 다음 사진은 미리 받아 둔다
  useEffect(() => {
    stage.current?.scrollTo({ top: 0 })
    const next = SLIDES[i + 1]?.img
    if (next) new Image().src = SHOT(next)
  }, [i])

  const sections = useMemo(() => SLIDES.map((x) => x.section), [])
  /** '5단계' → 5. 묶음 안에서 몇 번째인지 동그라미로 보여 준다 */
  const stepNo = s.step ? Number(s.step.replace(/[^0-9]/g, '')) : 0

  return (
    <section className="guide">
      <div className="guide-top no-print">
        <div className="guide-crumb">
          <b>사용 설명</b>
          <span className="muted small">
            {i + 1} / {SLIDES.length}
            {s.section ? ` · ${s.section}` : ''}
          </span>
        </div>
        <button className="btn sm ghost" onClick={() => go('')}>
          닫기
        </button>
      </div>
      <div className="guide-bar" aria-hidden="true">
        <span style={{ width: `${((i + 1) / SLIDES.length) * 100}%` }} />
      </div>

      <div
        className="guide-stage"
        ref={stage}
        onTouchStart={(e) => {
          touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        }}
        onTouchEnd={(e) => {
          const t = touch.current
          touch.current = null
          if (!t) return
          const dx = e.changedTouches[0].clientX - t.x
          const dy = e.changedTouches[0].clientY - t.y
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? i + 1 : i - 1)
        }}
      >
        {s.kind === 'intro' ? (
          <div className="guide-cover">
            <h1>{s.title}</h1>
            <p className="guide-lead">{s.lead}</p>
            <div className="guide-cards">
              {HIGHLIGHTS.map((h, n) => (
                <div className="guide-card big" key={h.title}>
                  <div className="guide-card-icon" aria-hidden="true">
                    {h.icon}
                  </div>
                  <b>
                    {n + 1}. {h.title}
                  </b>
                  <p>{h.body}</p>
                </div>
              ))}
            </div>
            {s.tip && <div className="guide-tip">{s.tip}</div>}
          </div>
        ) : s.kind === 'outro' ? (
          <div className="guide-cover">
            <h1>{s.title}</h1>
            <p className="guide-lead">{s.lead}</p>
            <div className="guide-cards">
              {EXTRAS.map((h) => (
                <div className="guide-card" key={h.title}>
                  <div className="guide-card-icon" aria-hidden="true">
                    {h.icon}
                  </div>
                  <b>{h.title}</b>
                  <p>{h.body}</p>
                </div>
              ))}
            </div>
            <div className="guide-go">
              <button className="btn primary lg" onClick={() => go('personal')}>
                서류 초안 작성하기
              </button>
              <button className="btn lg" onClick={() => go('compile')}>
                평가총괄표 작성
              </button>
            </div>
          </div>
        ) : (
          <div className="guide-slide">
            <figure className="guide-shot">
              <button type="button" className="guide-shot-btn" onClick={() => s.img && setZoom(SHOT(s.img))} aria-label="사진 크게 보기">
                <img src={SHOT(s.img!)} alt={s.alt || s.title} />
              </button>
              <figcaption className="muted small">사진을 누르면 크게 볼 수 있습니다</figcaption>
            </figure>
            <div className="guide-text">
              <div className="guide-badges">
                <span className="badge info">{s.section}</span>
              </div>
              <h2>
                {stepNo > 0 && <span className="guide-no">{stepNo}</span>}
                {s.title}
              </h2>
              <p className="guide-lead">{s.lead}</p>
              <ul className="guide-points">
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {s.tip && <div className="guide-tip">{s.tip}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="guide-nav no-print">
        <button className="btn" onClick={() => move(i - 1)} disabled={i === 0}>
          ← 이전
        </button>
        <div className="guide-dots">
          {sections.map((_, n) => (
            <button
              key={n}
              className={`guide-dot ${n === i ? 'on' : ''}`}
              onClick={() => move(n)}
              aria-label={`${n + 1}번째 화면`}
              aria-current={n === i ? 'true' : undefined}
            />
          ))}
        </div>
        {i === last ? (
          <button className="btn primary" onClick={() => go('personal')}>
            시작하기
          </button>
        ) : (
          <button className="btn primary" onClick={() => move(i + 1)}>
            다음 →
          </button>
        )}
      </div>

      {zoom && (
        <div className="modal-backdrop guide-zoom" onClick={() => setZoom(null)}>
          <img src={zoom} alt={s.alt || s.title} />
          <button className="btn sm" onClick={() => setZoom(null)}>
            닫기
          </button>
        </div>
      )}
    </section>
  )
}
