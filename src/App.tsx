import { AppDataProvider, useAppData, useHashRoute } from './store/useAppData'
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

function Shell() {
  const { ready } = useAppData()
  const [route, go] = useHashRoute()
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
