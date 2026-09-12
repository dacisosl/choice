import { useCallback, useEffect, useState } from 'react'
import { fmtDate, useAppData } from '../store/useAppData'
import { deleteSchool, listSchools, type SchoolIndexEntry } from '../store/school'

/**
 * 운영자(최종 관리자) 화면. 메뉴에 노출하지 않고 주소(#/root)로만 들어온다.
 * 학교 아이디·학교 이름·담당자 이메일·날짜만 다루며, 각 학교의 과목·출판사 내용은 여기서 읽지 않는다.
 */
export function Root({ go }: { go: (h: string) => void }) {
  const { accountEnabled, config, user, isSuperAdmin, busy, authError, signInGoogle, signOut } = useAppData()
  const [rows, setRows] = useState<SchoolIndexEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null>(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    if (!isSuperAdmin || !config.firebase) return
    setLoading(true)
    try {
      setRows(await listSchools(config.firebase))
      setMsg(null)
    } catch (e) {
      setMsg({ type: 'error', text: `목록을 읽지 못했습니다: ${(e as Error).message}` })
    } finally {
      setLoading(false)
    }
  }, [isSuperAdmin, config])

  useEffect(() => {
    load()
  }, [load])

  const remove = async (s: SchoolIndexEntry) => {
    if (!config.firebase) return
    if (!confirm(`'${s.schoolId}' (${s.schoolName}) 학교를 지울까요?\n학교 아이디와 그 학교의 과목·출판사 자료가 함께 지워지며 되돌릴 수 없습니다.`)) return
    try {
      await deleteSchool(config.firebase, s.schoolId)
      setRows((list) => list.filter((x) => x.schoolId !== s.schoolId))
      setMsg({ type: 'ok', text: `${s.schoolId} 학교를 지웠습니다.` })
    } catch (e) {
      setMsg({ type: 'error', text: `삭제 실패: ${(e as Error).message}` })
    }
  }

  if (!accountEnabled)
    return (
      <div className="card" style={{ maxWidth: 560, margin: '48px auto' }}>
        <h2>운영자 화면</h2>
        <p className="muted small">이 배포본에는 계정 기능이 꺼져 있습니다.</p>
      </div>
    )

  if (!user || !isSuperAdmin)
    return (
      <div className="card" style={{ maxWidth: 460, margin: '48px auto', textAlign: 'center' }}>
        <h2 style={{ justifyContent: 'center' }}>운영자 확인</h2>
        <p className="muted small">
          {user ? `${user.email} 계정은 운영자가 아닙니다.` : '운영자 구글 계정으로 로그인하세요.'}
        </p>
        <div className="actions" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={signInGoogle} disabled={busy}>
            {busy ? '진행 중…' : '구글 계정으로 로그인'}
          </button>
          {user && (
            <button className="btn" onClick={signOut}>
              로그아웃
            </button>
          )}
          <button className="btn ghost" onClick={() => go('')}>
            첫 화면으로
          </button>
        </div>
        {authError && <div className="alert error" style={{ marginTop: 14 }}>{authError}</div>}
      </div>
    )

  const shown = q.trim() ? rows.filter((r) => `${r.schoolId} ${r.schoolName} ${r.ownerEmail}`.includes(q.trim())) : rows

  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div className="card">
        <h2>
          학교 아이디 관리 <span className="muted small">— {rows.length}곳</span>
        </h2>
        <p className="muted small">
          {user.email} (운영자)로 보고 있습니다. 이 화면에는 학교 아이디·이름·담당자 이메일·날짜만 나옵니다. 각 학교가 등록한 과목·출판사 내용은 여기서 열지 않습니다.
        </p>
        <div className="actions" style={{ marginTop: 8 }}>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학교 아이디·이름·이메일 검색" style={{ maxWidth: 280 }} />
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={signOut}>
            로그아웃
          </button>
        </div>
        <div className="scroll-x" style={{ marginTop: 10 }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 170 }}>학교 아이디</th>
                <th>학교 이름</th>
                <th style={{ width: 220 }}>담당자 이메일</th>
                <th style={{ width: 110 }}>등록</th>
                <th style={{ width: 110 }}>최근 수정</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.schoolId}>
                  <td>
                    <code>{s.schoolId}</code>
                  </td>
                  <td>{s.schoolName}</td>
                  <td className="small">{s.ownerEmail}</td>
                  <td className="small">{fmtDate(s.createdAt)}</td>
                  <td className="small">{fmtDate(s.updatedAt)}</td>
                  <td>
                    <button className="btn sm danger" onClick={() => remove(s)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {loading ? '불러오는 중…' : '등록된 학교가 없습니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
