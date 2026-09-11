import { useState, type ReactNode } from 'react'
import { getUnlockedRoles, unlockRole, type Role } from '../store/useAppData'

interface Props {
  role: Role
  code: string
  title: string
  children: ReactNode
}

/** 접속 코드 게이트. code가 비어 있으면 통과 */
export function Gate({ role, code, title, children }: Props) {
  const [unlocked, setUnlocked] = useState(() => !code || getUnlockedRoles().includes(role))
  const [input, setInput] = useState('')
  const [err, setErr] = useState('')
  if (unlocked || !code) return <>{children}</>
  const submit = () => {
    if (input === code) {
      unlockRole(role)
      setUnlocked(true)
    } else setErr('코드가 일치하지 않습니다.')
  }
  return (
    <div className="gate">
      <div className="card">
        <h2>{title}</h2>
        <p className="muted small" style={{ marginBottom: 18 }}>
          담당 교사로부터 안내받은 접속 코드를 입력하세요.
        </p>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="코드"
          autoFocus
          style={{ width: '100%' }}
        />
        <div className="actions" style={{ justifyContent: 'center' }}>
          <button className="btn primary lg pill" onClick={submit} style={{ minWidth: 160 }}>
            확인
          </button>
        </div>
        {err && <div className="alert error" style={{ marginTop: 14 }}>{err}</div>}
      </div>
    </div>
  )
}
