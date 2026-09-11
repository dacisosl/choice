import { AppDataProvider, lockAll, useAppData, useHashRoute } from './store/useAppData'
import { Gate } from './components/Gate'
import { Start } from './pages/Start'
import { Personal } from './pages/Personal'
import { Compile } from './pages/Compile'
import { Admin } from './pages/Admin'

const ROUTE_LABEL: Record<string, string> = { personal: '개인서류 작성', compile: '평가총괄표 작성', admin: '관리' }

function Shell() {
  const { ready, error, master, mode } = useAppData()
  const [route, go] = useHashRoute()
  if (!ready) return <div className="app muted" style={{ paddingTop: 40 }}>불러오는 중…</div>
  const s = master.settings
  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="brand" onClick={() => go('')}>
          <span className="logo-mark">選</span>
          <span>
            교과서 <strong>선정도우미</strong>
            <span className="suffix">_{s.year}</span>
          </span>
        </div>
        <div className="center">
          {route && (
            <span className="ctx-chip">
              {s.year}학년도 <span className="dot">·</span> {s.schoolName} <span className="dot">·</span> <span className="live">{ROUTE_LABEL[route] || route}</span>
            </span>
          )}
        </div>
        <div className="meta">
          <span className={`badge ${mode === 'supabase' ? 'ok' : 'warn'}`}>{mode === 'supabase' ? '온라인 공유' : '브라우저 저장'}</span>
          {route && (
            <button className="btn" onClick={() => go('')}>
              처음으로
            </button>
          )}
          {route && (
            <button
              className="btn"
              onClick={() => {
                lockAll()
                go('')
              }}
            >
              잠금
            </button>
          )}
        </div>
      </header>
      {error && <div className="alert error no-print">{error}</div>}
      {route === '' && <Start go={go} />}
      {route === 'personal' && (
        <Gate role="teacher" code={s.accessCode} title="개인서류 작성">
          <Personal />
        </Gate>
      )}
      {route === 'compile' && (
        <Gate role="compiler" code={s.compilerCode || s.accessCode} title="평가총괄표 작성">
          <Compile />
        </Gate>
      )}
      {route === 'admin' && (
        <Gate role="admin" code={s.adminCode} title="관리">
          <Admin />
        </Gate>
      )}
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
