import { useEffect, useState } from 'react'
import { AppDataProvider, useAppData, useHashRoute } from './store/useAppData'
import { NoticeModal } from './components/NoticeModal'
import { Start } from './pages/Start'
import { Personal } from './pages/Personal'
import { Compile } from './pages/Compile'
import { Settings } from './pages/Settings'
import { Guide } from './pages/Guide'

const BookIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 6.5c-1.6-1.4-3.8-2-6.5-2H3v13h2.5c2.7 0 4.9.6 6.5 2 1.6-1.4 3.8-2 6.5-2H21v-13h-2.5c-2.7 0-4.9.6-6.5 2Z" />
    <path d="M12 6.5v13" />
  </svg>
)

/** 상단 [가격확인] 에서 여는 안내: 교과서 가격은 여기서 본다 */
const PRICE_LINKS = [
  {
    name: '한국교과서쇼핑몰',
    href: 'https://www.ktbookmall.com/user/shop/01_normal/list.do?cat=13&code=46161',
    note: '미래엔 교과서는 검색되지 않습니다. 미래엔 도서는 아래 링크에서 확인해 주세요.',
  },
  { name: '미래엔 도서몰', href: 'https://mall.mirae-n.com/main/index.do' },
]

function PriceModal({ onClose }: { onClose: () => void }) {
  return (
    <NoticeModal title="교과서 가격 확인" tone="info" cancelLabel="닫기" onClose={onClose}>
      <p className="price-lead">가격 정보는 아래 링크에서 참고하시면 됩니다.</p>
      <ol className="price-links">
        {PRICE_LINKS.map((l) => (
          <li key={l.href}>
            <a className="notice-link" href={l.href} target="_blank" rel="noopener noreferrer">
              {l.name} 열기 ↗
            </a>
            {l.note && <p className="price-note">{l.note}</p>}
          </li>
        ))}
      </ol>
    </NoticeModal>
  )
}

function Shell() {
  const { ready } = useAppData()
  const [route, go] = useHashRoute()
  const [priceOpen, setPriceOpen] = useState(false)
  // 지금 화면을 <html data-route> 로 알려 준다 — 정적 푸터의 제작자 표기를 첫 화면에서만 보이게 하는 데 쓴다
  useEffect(() => {
    document.documentElement.dataset.route = route || 'home'
  }, [route])
  if (!ready) return <div className="app muted" style={{ paddingTop: 40 }}>불러오는 중…</div>
  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="brand" onClick={() => go('')}>
          <BookIcon />
          <span>선정초안작성기</span>
        </div>
        <div id="topbar-slot" className="topbar-slot" />
        <div className="meta">
          <button className="btn sm ghost" onClick={() => setPriceOpen(true)}>
            가격확인
          </button>
          <button className={`btn sm ghost ${route === 'guide' ? 'active' : ''}`} onClick={() => go('guide')}>
            사용법
          </button>
          <button className={`btn sm ghost ${route === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}>
            설정
          </button>
        </div>
      </header>
      {route === '' && <Start go={go} />}
      {route === 'guide' && <Guide go={go} />}
      {route === 'personal' && <Personal go={go} />}
      {route === 'compile' && <Compile go={go} />}
      {(route === 'settings' || route === 'admin') && <Settings go={go} />}
      {priceOpen && <PriceModal onClose={() => setPriceOpen(false)} />}
    </div>
  )
}

export default function App() {
  return (
    <AppDataProvider>
      <Shell />
    </AppDataProvider>
  )
}
