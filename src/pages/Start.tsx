import { useEffect, useState } from 'react'
import { useAppData } from '../store/useAppData'
import { useAuth } from '../store/auth'

/** public/hero.png 가 있으면 사진을 배경으로 쓴다 (문구가 없는 책·책상 부분만 잘라서 사용) */
const HERO_URL = `${import.meta.env.BASE_URL}hero.png`
function useHeroImage(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => setOk(true)
    img.onerror = () => setOk(false)
    img.src = HERO_URL
  }, [])
  return ok
}

/** 사진이 없을 때 쓰는 대체 책 표지 일러스트 */
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
      <g transform="translate(176 76)">
        <rect x="0" y="14" width="46" height="28" fill="#f1ede4" stroke="#6f8a78" strokeWidth="1.2" />
        <path d="M-3 14 L23 0 L49 14 Z" fill="#7a9d78" />
        <rect x="19" y="26" width="8" height="16" fill="#6f8a78" />
        <rect x="6" y="20" width="6" height="7" fill="#c9d8c2" />
        <rect x="34" y="20" width="6" height="7" fill="#c9d8c2" />
      </g>
      <path d="M0 122 C50 100, 100 108, 150 118 S230 140, 274 126 V190 H0 Z" fill="url(#hillB)" />
      {[
        [34, 96, 1],
        [58, 88, 1.2],
        [82, 98, 0.9],
        [118, 112, 1],
      ].map(([x, y, s], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
          <rect x="-1.5" y="10" width="3" height="12" fill="#5c6b58" />
          <circle cx="0" cy="4" r="10" fill="#3f6e56" />
          <circle cx="-5" cy="8" r="7" fill="#4a7a5f" />
          <circle cx="5" cy="9" r="7" fill="#4a7a5f" />
        </g>
      ))}
      <path d="M0 154 C60 132, 120 140, 170 150 S240 170, 274 158 V190 H0 Z" fill="url(#hillC)" />
      <path d="M0 176 C50 160, 110 166, 160 176 S240 190, 274 182 V190 H0 Z" fill="#3a6a52" />
    </svg>
  )
}

export function Start({ go }: { go: (h: string) => void }) {
  const { master, mode, evaluations, summaries } = useAppData()
  const { enabled: authEnabled, isApproved } = useAuth()
  const submitted = evaluations.filter((e) => e.status === 'submitted').length
  const finalized = summaries.filter((s) => s.status === 'finalized').length
  const openSubjects = master.subjects.filter((s) => master.publishers.filter((p) => p.subjectId === s.id).length > 1).length
  const showStats = !authEnabled || isApproved
  const heroImg = useHeroImage()

  if (heroImg === null) return <section className="hero-split" style={{ minHeight: 560 }} />

  return (
    <>
      <section className={`hero-split ${heroImg ? 'with-photo' : ''}`}>
        {heroImg && (
          <div className="hero-photo" aria-hidden="true">
            <img src={HERO_URL} alt="" />
          </div>
        )}

        <div className="hero-left">
          <div className="eyebrow">선생님을 위한 문서 작성 도구</div>
          <h1>
            교과서 선정 서류,
            <br />
            초안부터 간편하게
          </h1>
          <p className="lead">교과서 정보를 입력하면 선정에 필요한 서류 초안을 만들어 드려요.</p>
          {!heroImg && (
            <div className="books-fallback" aria-hidden="true">
              <div className="book front">
                <div className="spine">교과서</div>
                <div className="cover">
                  <div className="title">교과서</div>
                  <div className="sub">배움의 시작</div>
                  <FrontCoverArt />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="hero-right">
          <div className="start-label">여기를 눌러 시작하세요</div>
          <button className="cta-big" onClick={() => go('personal')}>
            <span>서류 초안</span>
            <span>작성하기</span>
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </button>
          <div className="compile-ask">총괄 작성 교사이신가요?</div>
          <button className="chip-pill" onClick={() => go('compile')}>
            평가총괄표 작성 <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      <div className="steps3">
        <div className="s">
          <div className="num">01</div>
          <div>
            <h4>교과서 정보 입력</h4>
            <p>교과서 기본 정보를 입력해 주세요.</p>
          </div>
        </div>
        <div className="s">
          <div className="num">02</div>
          <div>
            <h4>선정 기준 정리</h4>
            <p>학교의 선정 기준에 맞춰 내용을 정리해요.</p>
          </div>
        </div>
        <div className="s">
          <div className="num">03</div>
          <div>
            <h4>서류 초안 확인</h4>
            <p>입력한 내용을 바탕으로 초안을 바로 확인해요.</p>
          </div>
        </div>
      </div>

      {showStats && (
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
      )}
    </>
  )
}
