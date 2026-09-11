import { AppDataProvider, lockAll, useAppData, useHashRoute } from './store/useAppData'
import { AuthProvider, useAuth } from './store/auth'
import { AuthGate } from './components/AuthGate'
import { Gate } from './components/Gate'
import { Start } from './pages/Start'
import { Guide } from './pages/Guide'
import { Personal } from './pages/Personal'
import { Compile } from './pages/Compile'
import { Admin } from './pages/Admin'

const BookIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 6.5c-1.6-1.4-3.8-2-6.5-2H3v13h2.5c2.7 0 4.9.6 6.5 2 1.6-1.4 3.8-2 6.5-2H21v-13h-2.5c-2.7 0-4.9.6-6.5 2Z" />
    <path d="M12 6.5v13" />
  </svg>
)

function Shell() {
  const { ready, error, master, mode } = useAppData()
  const { enabled: authEnabled, user, member, isAdmin, signOutUser, localOnly, exitLocalOnly } = useAuth()
  const [route, go] = useHashRoute()
  if (!ready) return <div className="app muted" style={{ paddingTop: 40 }}>불러오는 중…</div>
  const s = master.settings
  const nav = (key: string, label: string, optional = false) => (
    <button className={`${route === key ? 'active' : ''} ${optional ? 'optional' : ''}`} onClick={() => go(key)}>
      {label}
    </button>
  )
  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="brand" onClick={() => go('')}>
          <BookIcon />
          <span>
            교과서 선정 도우미<span className="suffix">{s.year}</span>
          </span>
        </div>
        <nav>
          {nav('guide', '이용 안내')}
          {nav('personal', '내 문서')}
          {nav('compile', '총괄표', true)}
          {(!authEnabled || isAdmin) && nav('admin', '관리', true)}
        </nav>
        <div className="meta">
          <span className={`badge ${mode !== 'local' ? 'ok' : 'warn'}`}>{mode === 'local' ? '브라우저 저장' : '온라인 공유'}</span>
          {authEnabled && member && (
            <span className="who">
              {user?.photoURL && <img className="avatar" src={user.photoURL} alt="" />}
              <strong>{member.displayName}</strong>
              {isAdmin && <span className="badge info">관리자</span>}
            </span>
          )}
          {localOnly && (
            <button className="btn sm" onClick={exitLocalOnly}>
              로그인하기
            </button>
          )}
          {authEnabled ? (
            <button className="btn sm ghost" onClick={signOutUser}>
              로그아웃
            </button>
          ) : (
            route && (
              <button
                className="btn sm ghost"
                onClick={() => {
                  lockAll()
                  go('')
                }}
              >
                잠금
              </button>
            )
          )}
        </div>
      </header>
      {error && <div className="alert error no-print">{error}</div>}
      {route === '' && <Start go={go} />}
      {route === 'guide' && <Guide go={go} />}
      {route === 'personal' &&
        (authEnabled ? (
          <Personal />
        ) : (
          <Gate role="teacher" code={s.accessCode} title="개인서류 작성">
            <Personal />
          </Gate>
        ))}
      {route === 'compile' &&
        (authEnabled ? (
          <Compile />
        ) : (
          <Gate role="compiler" code={s.compilerCode || s.accessCode} title="평가총괄표 작성">
            <Compile />
          </Gate>
        ))}
      {route === 'admin' &&
        (authEnabled ? (
          isAdmin ? (
            <Admin />
          ) : (
            <div className="card" style={{ maxWidth: 460, margin: '48px auto', textAlign: 'center' }}>
              <h2 style={{ justifyContent: 'center' }}>관리자 전용</h2>
              <p className="muted small">이 화면은 관리자로 지정된 계정만 볼 수 있습니다. 담당 교사에게 문의하세요.</p>
            </div>
          )
        ) : (
          <Gate role="admin" code={s.adminCode} title="관리">
            <Admin />
          </Gate>
        ))}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <AppDataProvider>
          <Shell />
        </AppDataProvider>
      </AuthGate>
    </AuthProvider>
  )
}
