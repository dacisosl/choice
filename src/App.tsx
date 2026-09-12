import { AppDataProvider, useAppData, useHashRoute } from './store/useAppData'
import { Start } from './pages/Start'
import { Personal } from './pages/Personal'
import { Compile } from './pages/Compile'
import { Settings } from './pages/Settings'
import { Privacy } from './pages/Privacy'

const BookIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 6.5c-1.6-1.4-3.8-2-6.5-2H3v13h2.5c2.7 0 4.9.6 6.5 2 1.6-1.4 3.8-2 6.5-2H21v-13h-2.5c-2.7 0-4.9.6-6.5 2Z" />
    <path d="M12 6.5v13" />
  </svg>
)

function Shell() {
  const { ready, schoolStatus, schoolId, school, isOwner } = useAppData()
  const [route, go] = useHashRoute()
  if (!ready) return <div className="app muted" style={{ paddingTop: 40 }}>불러오는 중…</div>
  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="brand" onClick={() => go('')}>
          <BookIcon />
          <span>선정초안작성기</span>
        </div>
        <div className="meta">
          <span className="badge gray" title="작성한 평가표와 총괄표는 이 컴퓨터에만 저장됩니다. 서버로 올라가지 않습니다.">
            문서: 이 컴퓨터에 저장
          </span>
          {schoolStatus === 'ok' && school && (
            <button className="badge ok as-link" onClick={() => go('settings')} title={`학교 아이디 ${schoolId} 의 과목·출판사를 쓰고 있습니다`}>
              {school.schoolName || schoolId}
            </button>
          )}
          {schoolStatus === 'missing' && (
            <button className="badge warn as-link" onClick={() => go('settings')}>
              학교 아이디 확인 필요
            </button>
          )}
          {schoolStatus === 'error' && (
            <button className="badge warn as-link" onClick={() => go('settings')}>
              학교 자료 연결 실패
            </button>
          )}
          {isOwner && <span className="badge info">담당자</span>}
          <button className={`btn sm ghost ${route === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}>
            설정
          </button>
        </div>
      </header>
      {route === '' && <Start go={go} />}
      {route === 'personal' && <Personal />}
      {route === 'compile' && <Compile />}
      {(route === 'settings' || route === 'admin') && <Settings go={go} />}
      {route === 'privacy' && <Privacy go={go} />}
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
