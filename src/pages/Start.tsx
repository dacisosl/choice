import { useAppData } from '../store/useAppData'

/** 앞 책: 크림 표지 + 초록 언덕·나무·해·학교 */
function FrontCoverArt() {
  return (
    <svg viewBox="0 0 274 190" aria-hidden="true">
      <defs>
        <linearGradient id="hillA" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9d8c2" />
          <stop offset="1" stopColor="#b3c8ad" />
        </linearGradient>
        <linearGradient id="hillB" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fae8b" />
          <stop offset="1" stopColor="#7a9d78" />
        </linearGradient>
        <linearGradient id="hillC" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5e8b6e" />
          <stop offset="1" stopColor="#4a7a5f" />
        </linearGradient>
      </defs>
      <circle cx="212" cy="58" r="14" fill="#e8c46a" />
      <path d="M0 96 C60 70, 120 74, 170 90 S250 120, 274 100 V190 H0 Z" fill="url(#hillA)" />
      {/* 학교 */}
      <g transform="translate(176 76)">
        <rect x="0" y="14" width="46" height="28" fill="#f1ede4" stroke="#6f8a78" strokeWidth="1.2" />
        <path d="M-3 14 L23 0 L49 14 Z" fill="#7a9d78" />
        <rect x="19" y="26" width="8" height="16" fill="#6f8a78" />
        <rect x="6" y="20" width="6" height="7" fill="#c9d8c2" />
        <rect x="34" y="20" width="6" height="7" fill="#c9d8c2" />
        <line x1="23" y1="0" x2="23" y2="-10" stroke="#6f8a78" strokeWidth="1.2" />
        <path d="M23 -10 L31 -7 L23 -4 Z" fill="#b4432f" />
      </g>
      <path d="M0 122 C50 100, 100 108, 150 118 S230 140, 274 126 V190 H0 Z" fill="url(#hillB)" />
      {/* 나무들 */}
      {[
        [34, 96, 1],
        [58, 88, 1.2],
        [82, 98, 0.9],
        [118, 112, 1],
        [246, 114, 0.9],
      ].map(([x, y, s], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
          <rect x="-1.5" y="10" width="3" height="12" fill="#5c6b58" />
          <circle cx="0" cy="4" r="10" fill="#3f6e56" />
          <circle cx="-5" cy="8" r="7" fill="#4a7a5f" />
          <circle cx="5" cy="9" r="7" fill="#4a7a5f" />
        </g>
      ))}
      {/* 길 */}
      <path d="M126 190 C136 160, 160 150, 176 146 C192 142, 200 128, 199 118" stroke="#f3eee3" strokeWidth="9" fill="none" strokeLinecap="round" />
      <path d="M0 154 C60 132, 120 140, 170 150 S240 170, 274 158 V190 H0 Z" fill="url(#hillC)" />
      <path d="M0 176 C50 160, 110 166, 160 176 S240 190, 274 182 V190 H0 Z" fill="#3a6a52" />
    </svg>
  )
}

/** 뒤 책: 하늘색 표지 + 호수·산·침엽수 */
function BackCoverArt() {
  return (
    <svg viewBox="0 0 150 170" aria-hidden="true">
      <rect x="0" y="0" width="150" height="170" fill="#dfe6ea" />
      <path d="M0 70 L30 42 L58 66 L86 36 L118 62 L150 44 V170 H0 Z" fill="#9fb3c1" />
      <path d="M0 96 L40 80 L80 92 L120 78 L150 90 V170 H0 Z" fill="#6f8f9c" />
      <rect x="0" y="118" width="150" height="52" fill="#8fb1bd" />
      <path d="M0 118 C40 112, 90 124, 150 116 V170 H0 Z" fill="#a7c4cd" />
      {[
        [18, 104, 1.1],
        [34, 110, 0.8],
        [126, 104, 1],
        [140, 112, 0.7],
      ].map(([x, y, s], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
          <path d="M0 -22 L9 0 H-9 Z" fill="#3d6650" />
          <path d="M0 -12 L11 8 H-11 Z" fill="#2f5d4b" />
          <rect x="-1.5" y="8" width="3" height="6" fill="#4c5a50" />
        </g>
      ))}
      <path d="M0 150 C40 144, 100 156, 150 148 V170 H0 Z" fill="#5f8a74" />
    </svg>
  )
}

export function Start({ go }: { go: (h: string) => void }) {
  const { master, mode, evaluations, summaries } = useAppData()
  const submitted = evaluations.filter((e) => e.status === 'submitted').length
  const finalized = summaries.filter((s) => s.status === 'finalized').length
  const openSubjects = master.subjects.filter((s) => master.publishers.filter((p) => p.subjectId === s.id).length > 1).length

  return (
    <section className="hero">
      <div className="eyebrow">선생님을 위한 문서 작성 도구</div>
      <h1>
        교과서 선정 서류,
        <br />
        초안부터 간편하게
      </h1>
      <p className="lead">
        과목과 <b>1·2·3순위 출판사</b>만 고르면 선정에 필요한 서류 초안을 만들어 드려요.
      </p>

      <div className="books" aria-hidden="true">
        <div className="floor" />
        <div className="book back">
          <div className="spine">사회</div>
          <div className="cover tinted">
            <div className="title">사회</div>
            <div className="sub">더 넓은 세상을 만나는 시간</div>
            <BackCoverArt />
          </div>
        </div>
        <div className="book front">
          <div className="spine">교과서</div>
          <div className="cover">
            <span className="corner" style={{ left: 22, top: 18 }}>
              오늘의
              <br />
              배움이
              <br />
              더 나은
              <br />
              내일을 만듭니다
            </span>
            <span className="corner" style={{ right: 22, top: 18 }}>
              함께 배우고
              <br />
              더 멀리 성장하는
              <br />
              우리
            </span>
            <div className="title">교과서</div>
            <div className="sub">배움의 시작</div>
            <FrontCoverArt />
          </div>
        </div>
      </div>

      <div className="cta-wrap">
        <button className="cta" onClick={() => go('personal')}>
          서류 초안 작성하기 <span className="arrow">→</span>
        </button>
        <p className="cta-sub">정보 입력부터 초안 완성까지, 차근차근</p>
        <div className="role-links">
          <span>
            총괄 작성 교사이신가요? <button onClick={() => go('compile')}>평가총괄표 작성 →</button>
          </span>
          <span>
            담당 교사이신가요? <button onClick={() => go('admin')}>관리 →</button>
          </span>
        </div>
      </div>

      <div className="steps3">
        <div className="s">
          <div className="num">01</div>
          <div>
            <h4>과목·순위 입력</h4>
            <p>과목을 고르고 1·2·3순위 출판사를 선택해요.</p>
          </div>
        </div>
        <div className="s">
          <div className="num">02</div>
          <div>
            <h4>평가표·의견 정리</h4>
            <p>자동 채워진 점수를 다듬고 핵심의견으로 문장을 만들어요.</p>
          </div>
        </div>
        <div className="s">
          <div className="num">03</div>
          <div>
            <h4>서류 초안 확인</h4>
            <p>서식1·서식3 초안을 확인하고 제출·인쇄해요.</p>
          </div>
        </div>
      </div>

      <div className="stats-line">
        <span>
          작성 가능 과목 <b>{openSubjects}</b>
        </span>
        <span>
          제출 <b>{submitted}</b>건
        </span>
        <span>
          총괄 확정 <b>{finalized}</b>과목
        </span>
        <span>{mode === 'local' ? '이 브라우저 저장 모드' : '온라인 공유 모드'}</span>
      </div>
      {mode === 'local' && (
        <p className="start-note">
          현재 데이터는 이 브라우저에만 저장됩니다. 여러 교사와 공유하려면 상단에서 로그인하거나, 개인서류 화면의 [파일로 내보내기]로 총괄 교사에게 전달하세요.
        </p>
      )}
    </section>
  )
}
