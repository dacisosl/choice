import { useState, type ReactNode } from 'react'
import { useAuth } from '../store/auth'
import { fmtDate } from '../store/useAppData'

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.4z" />
    <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.8-6.1z" />
    <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.5l-7.1-5.5c-2 1.3-4.6 2.1-8.2 2.1-6.4 0-11.7-3.7-13.6-8.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
)

/** 구글 로그인 + 관리자 승인 게이트. Firebase 설정이 없으면 그대로 통과한다. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, enabled, user, member, error, busy, signIn, signOutUser, submitProfile, reloadMember, enterLocalOnly, isOwner } = useAuth()
  const [name, setName] = useState('')

  if (!enabled) return <>{children}</>
  if (!ready) return <div className="app muted" style={{ paddingTop: 40 }}>확인 중…</div>

  // 1) 로그인 전
  if (!user) {
    return (
      <div className="auth-screen">
        <div className="card">
          <h2>로그인</h2>
          <p className="muted small">
            학교 구성원 확인을 위해 구글 계정으로 로그인합니다. 로그인 후 이름을 입력하면 관리자 승인을 거쳐 이용할 수 있습니다.
          </p>
          <button className="btn lg google" onClick={signIn} disabled={busy}>
            <GoogleMark />
            {busy ? '진행 중…' : '구글 계정으로 로그인'}
          </button>
          {error && <div className="alert error" style={{ marginTop: 16 }}>{error}</div>}
          <p className="small" style={{ marginTop: 18, marginBottom: 0 }}>
            <button className="btn sm" onClick={enterLocalOnly}>
              로그인 없이 이 브라우저에서만 사용
            </button>
          </p>
          <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
            작성과 인쇄는 되지만 다른 교사와 공유되지 않습니다.
          </p>
        </div>
      </div>
    )
  }

  // 2) 로그인했지만 아직 신청 전 → 이름 설정
  if (!member) {
    const trimmed = name.trim()
    return (
      <div className="auth-screen">
        <div className="card">
          <h2>이름 설정</h2>
          <p className="muted small">서식의 위원명으로 쓰입니다. 실명으로 입력하세요. 신청 후 관리자가 승인하면 이용할 수 있습니다.</p>
          <div className="who">
            {user.photoURL && <img className="avatar" src={user.photoURL} alt="" />}
            <span>{user.email}</span>
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && trimmed && submitProfile(trimmed)}
            placeholder={user.googleName || '홍길동'}
            autoFocus
            style={{ width: '100%', marginTop: 14 }}
          />
          <div className="actions" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={signOutUser}>
              다른 계정으로
            </button>
            <button className="btn primary" onClick={() => submitProfile(trimmed)} disabled={!trimmed || busy}>
              {busy ? '신청 중…' : '가입 신청'}
            </button>
          </div>
          {error && <div className="alert error" style={{ marginTop: 14 }}>{error}</div>}
        </div>
      </div>
    )
  }

  // 3) 승인 대기 / 거절 (최초 관리자 계정은 통과)
  if (member.status !== 'approved' && !isOwner) {
    const rejected = member.status === 'rejected'
    return (
      <div className="auth-screen">
        <div className="card">
          <h2>{rejected ? '승인 거절됨' : '승인 대기 중'}</h2>
          <p className="muted small">
            {rejected
              ? '관리자가 이 계정의 이용을 거절했습니다. 담당 교사에게 문의하세요.'
              : '관리자가 승인하면 바로 이용할 수 있습니다. 승인 후 아래 버튼을 눌러 상태를 확인하세요.'}
          </p>
          <div className="who">
            {user.photoURL && <img className="avatar" src={user.photoURL} alt="" />}
            <span>
              <strong>{member.displayName}</strong> · {member.email}
            </span>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>신청 {fmtDate(member.requestedAt)}</p>
          {rejected && member.note && <div className="alert warn" style={{ marginTop: 12 }}>{member.note}</div>}
          <div className="actions" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={signOutUser}>
              로그아웃
            </button>
            {!rejected && (
              <button className="btn primary" onClick={reloadMember} disabled={busy}>
                {busy ? '확인 중…' : '상태 새로고침'}
              </button>
            )}
          </div>
          {error && <div className="alert error" style={{ marginTop: 14 }}>{error}</div>}
        </div>
      </div>
    )
  }

  return <>{children}</>
}
