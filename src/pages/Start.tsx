import { useEffect, useState } from 'react'
import { SettingsJsonModal } from '../components/SettingsJsonModal'

/** 문구·버튼이 없는 책·책상 부분만 잘라 둔 사진 (public/hero-band.png) */
const HERO_URL = `${import.meta.env.BASE_URL}hero-band.png`
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
  const heroImg = useHeroImage()
  const [jsonOpen, setJsonOpen] = useState(false)
  if (heroImg === null) return <section className="hero-split" style={{ minHeight: 560 }} />

  return (
    <section className={`hero-split ${heroImg ? 'with-photo' : ''}`}>
      {heroImg && (
        <div className="hero-photo" aria-hidden="true">
          <img src={HERO_URL} alt="" />
        </div>
      )}

      <div className="hero-left">
        <h1>
          교과서 선정 서류,
          <br />
          초안부터 간편하게
        </h1>
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
        <button className="cta-tall" onClick={() => go('personal')}>
          <span className="cta-tall-label">여기를 눌러 시작하세요</span>
          <span className="cta-tall-title">
            서류 초안
            <br />
            작성하기
          </span>
          <span className="cta-tall-arrow" aria-hidden="true">
            →
          </span>
        </button>
        <button className="chip-pill" onClick={() => go('compile')}>
          <span className="chip-sub">총괄 작성 교사라면</span> 평가총괄표 작성 <span aria-hidden="true">→</span>
        </button>
        <div className="hero-links">
          <button className="hero-guide" onClick={() => go('guide')}>
            <span aria-hidden="true">▶</span> 처음이신가요? <b>1분 사용법 보기</b>
          </button>
          <button className="hero-guide" onClick={() => setJsonOpen(true)} title="학교 안에서 평가기준·설정을 파일로 나눠 쓰기">
            <span aria-hidden="true">{ }</span> <b>설정 JSON</b> 저장·불러오기
          </button>
        </div>
      </div>
      {jsonOpen && <SettingsJsonModal onClose={() => setJsonOpen(false)} />}
    </section>
  )
}
