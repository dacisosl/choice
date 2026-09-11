import { useCallback, useEffect, useState } from 'react'
import type { Member } from '../types'
import { useAuth } from '../store/auth'
import { fmtDate } from '../store/useAppData'

/** 관리 › 회원 관리 — 구글 로그인 계정 승인·권한 */
export function MembersTab() {
  const { enabled, user, listMembers, saveMember, deleteMember, refreshPending } = useAuth()
  const [rows, setRows] = useState<Member[]>([])
  const [msg, setMsg] = useState<{ type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      setRows(await listMembers())
      setMsg(null)
    } catch (e) {
      setMsg({ type: 'error', text: `명단을 읽지 못했습니다: ${(e as Error).message}` })
    } finally {
      setLoading(false)
    }
  }, [enabled, listMembers])

  useEffect(() => {
    load()
  }, [load])

  const apply = async (m: Member, patch: Partial<Member>, text: string) => {
    try {
      const next: Member = { ...m, ...patch, decidedAt: new Date().toISOString() }
      await saveMember(next)
      setRows((list) => list.map((x) => (x.uid === m.uid ? next : x)))
      refreshPending()
      setMsg({ type: 'ok', text })
    } catch (e) {
      setMsg({ type: 'error', text: `변경 실패: ${(e as Error).message}` })
    }
  }

  const remove = async (m: Member) => {
    if (m.uid === user?.uid) return setMsg({ type: 'warn', text: '본인 계정은 삭제할 수 없습니다.' })
    if (!confirm(`${m.displayName}(${m.email}) 계정을 명단에서 삭제할까요? 다시 로그인하면 재신청할 수 있습니다.`)) return
    try {
      await deleteMember(m.uid)
      setRows((list) => list.filter((x) => x.uid !== m.uid))
      refreshPending()
      setMsg({ type: 'ok', text: '삭제했습니다.' })
    } catch (e) {
      setMsg({ type: 'error', text: `삭제 실패: ${(e as Error).message}` })
    }
  }

  if (!enabled)
    return (
      <div className="card">
        <h2>회원 관리</h2>
        <p className="muted small">
          구글 로그인이 꺼져 있습니다. <code>public/config.json</code> 에 Firebase 설정이 있어야 이 화면을 쓸 수 있습니다. 지금은 접속 코드 방식으로 동작합니다.
        </p>
      </div>
    )

  const pending = rows.filter((r) => r.status === 'pending')
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter)
  const label = (s: Member['status']) =>
    s === 'approved' ? <span className="badge ok">승인</span> : s === 'pending' ? <span className="badge warn">대기</span> : <span className="badge gray">거절</span>

  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      {pending.length > 0 && (
        <div className="alert info">
          승인 대기 <strong>{pending.length}</strong>명이 있습니다.
        </div>
      )}
      <div className="card">
        <h2>
          회원 관리 <span className="muted">— 구글 로그인 계정 {rows.length}명</span>
        </h2>
        <p className="muted small">승인된 계정만 서류를 작성·조회할 수 있습니다. 관리자로 지정하면 이 관리 화면도 볼 수 있습니다.</p>
        <div className="actions" style={{ marginTop: 8 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ flex: '0 0 auto' }}>
            <option value="all">전체</option>
            <option value="pending">대기</option>
            <option value="approved">승인</option>
            <option value="rejected">거절</option>
          </select>
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
        <div className="scroll-x" style={{ marginTop: 10 }}>
          <table className="data">
            <thead>
              <tr>
                <th>이름</th>
                <th>구글 계정</th>
                <th style={{ width: 70 }}>상태</th>
                <th style={{ width: 76 }}>권한</th>
                <th style={{ width: 104 }}>신청</th>
                <th style={{ width: 250 }}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.uid}>
                  <td>
                    <input
                      type="text"
                      value={m.displayName}
                      onChange={(e) => setRows((list) => list.map((x) => (x.uid === m.uid ? { ...x, displayName: e.target.value } : x)))}
                      onBlur={() => apply(m, { displayName: m.displayName }, '이름을 저장했습니다.')}
                    />
                  </td>
                  <td className="small">
                    {m.email}
                    {m.uid === user?.uid && (
                      <span className="badge info" style={{ marginLeft: 6 }}>
                        나
                      </span>
                    )}
                  </td>
                  <td>{label(m.status)}</td>
                  <td>{m.role === 'admin' ? <span className="badge info">관리자</span> : <span className="muted small">위원</span>}</td>
                  <td className="small">{fmtDate(m.requestedAt)}</td>
                  <td>
                    {m.status !== 'approved' && (
                      <button className="btn sm" onClick={() => apply(m, { status: 'approved' }, `${m.displayName} 승인됨`)}>
                        승인
                      </button>
                    )}{' '}
                    {m.status !== 'rejected' && m.uid !== user?.uid && (
                      <button className="btn sm" onClick={() => apply(m, { status: 'rejected' }, `${m.displayName} 거절됨`)}>
                        거절
                      </button>
                    )}{' '}
                    {m.status === 'approved' && m.uid !== user?.uid && (
                      <button className="btn sm" onClick={() => apply(m, { role: m.role === 'admin' ? 'member' : 'admin' }, '권한을 변경했습니다.')}>
                        {m.role === 'admin' ? '관리자 해제' : '관리자 지정'}
                      </button>
                    )}{' '}
                    <button className="btn sm danger" onClick={() => remove(m)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {loading ? '불러오는 중…' : '해당하는 계정이 없습니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="note">
          첫 관리자는 Firebase 콘솔의 <code>choice_members</code> 컬렉션에서 본인 문서의 <code>role</code> 을 <code>admin</code>, <code>status</code> 를 <code>approved</code> 로 직접 바꿔 지정합니다. 자세한 절차는 README를 참고하세요.
        </p>
      </div>
    </div>
  )
}
