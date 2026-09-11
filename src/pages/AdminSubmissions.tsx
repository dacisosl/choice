import { useState } from 'react'
import { fmtDate, useAppData } from '../store/useAppData'
import { downloadText } from '../lib/csv'

/** 관리 › 제출 관리 — 개인 제출본과 총괄표 조회·제출취소·삭제·내려받기 */
export function SubmissionsTab() {
  const { master, evaluations, summaries, saveEvaluation, deleteEvaluation, saveSummary, deleteSummary, saveMaster, refresh, mode } = useAppData()
  const [msg, setMsg] = useState<{ type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null>(null)
  const [subjectId, setSubjectId] = useState('')
  const [status, setStatus] = useState<'all' | 'draft' | 'submitted'>('all')

  const subjName = (id: string) => master.subjects.find((s) => s.id === id)?.name || '(삭제된 과목)'
  const evs = evaluations
    .filter((e) => (!subjectId || e.subjectId === subjectId) && (status === 'all' || e.status === status))
    .sort((a, b) => (b.submittedAt || b.updatedAt).localeCompare(a.submittedAt || a.updatedAt))
  const sums = summaries.filter((s) => !subjectId || s.subjectId === subjectId)

  const wrap = async (fn: () => Promise<void>, text: string) => {
    try {
      await fn()
      setMsg({ type: 'ok', text })
    } catch (e) {
      setMsg({ type: 'error', text: `실패: ${(e as Error).message}` })
    }
  }
  const unsubmit = (id: string) => {
    const e = evaluations.find((x) => x.id === id)
    if (!e) return
    wrap(() => saveEvaluation({ ...e, status: 'draft', submittedAt: undefined }), '제출을 취소했습니다. 작성자가 다시 수정할 수 있습니다.')
  }
  const removeEval = (id: string) => {
    const e = evaluations.find((x) => x.id === id)
    if (!e) return
    if (!confirm(`${e.teacherName} 위원의 ${subjName(e.subjectId)} 제출본을 삭제할까요? 되돌릴 수 없습니다.`)) return
    wrap(() => deleteEvaluation(id), '삭제했습니다.')
  }
  const unfinalize = (id: string) => {
    const s = summaries.find((x) => x.id === id)
    if (!s) return
    wrap(async () => {
      await saveSummary({ ...s, status: 'draft', finalizedAt: undefined })
      await saveMaster({ ...master, subjects: master.subjects.map((x) => (x.id === s.subjectId ? { ...x, status: 'open' } : x)) })
    }, '확정을 취소하고 과목 마감을 해제했습니다.')
  }
  const removeSummary = (id: string) => {
    const s = summaries.find((x) => x.id === id)
    if (!s) return
    if (!confirm(`${subjName(s.subjectId)} 총괄표를 삭제할까요? 개인 제출본은 남습니다.`)) return
    wrap(async () => {
      await deleteSummary(id)
      await saveMaster({ ...master, subjects: master.subjects.map((x) => (x.id === s.subjectId ? { ...x, status: 'open' } : x)) })
    }, '총괄표를 삭제하고 과목을 다시 열었습니다.')
  }
  const exportOne = (name: string, data: unknown) => downloadText(name, JSON.stringify(data, null, 2), 'application/json')
  const exportAll = () =>
    downloadText(`submissions_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ evaluations, summaries }, null, 2), 'application/json')

  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div className="card">
        <h2>
          제출 관리 <span className="muted">— 개인 제출본 {evaluations.length}건 · 총괄표 {summaries.length}건</span>
        </h2>
        <div className="actions" style={{ marginTop: 4 }}>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={{ flex: '0 0 auto', maxWidth: 220 }}>
            <option value="">전체 과목</option>
            {master.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ flex: '0 0 auto' }}>
            <option value="all">전체 상태</option>
            <option value="submitted">제출</option>
            <option value="draft">작성 중</option>
          </select>
          {mode !== 'local' && (
            <button className="btn" onClick={refresh}>
              새로고침
            </button>
          )}
          <button className="btn" onClick={exportAll}>
            전체 내려받기(JSON)
          </button>
        </div>
        <div className="scroll-x" style={{ marginTop: 10 }}>
          <table className="data">
            <thead>
              <tr>
                <th>과목</th>
                <th>위원</th>
                <th style={{ width: 76 }}>상태</th>
                <th style={{ width: 104 }}>제출</th>
                <th style={{ width: 104 }}>최종 수정</th>
                <th style={{ width: 220 }}></th>
              </tr>
            </thead>
            <tbody>
              {evs.map((e) => (
                <tr key={e.id}>
                  <td>{subjName(e.subjectId)}</td>
                  <td>{e.teacherName}</td>
                  <td>{e.status === 'submitted' ? <span className="badge ok">제출</span> : <span className="badge warn">작성 중</span>}</td>
                  <td className="small">{e.submittedAt ? fmtDate(e.submittedAt) : '-'}</td>
                  <td className="small">{fmtDate(e.updatedAt)}</td>
                  <td>
                    <button className="btn sm" onClick={() => exportOne(`제출_${subjName(e.subjectId)}_${e.teacherName}.json`, e)}>
                      내려받기
                    </button>{' '}
                    {e.status === 'submitted' && (
                      <button className="btn sm" onClick={() => unsubmit(e.id)}>
                        제출 취소
                      </button>
                    )}{' '}
                    <button className="btn sm danger" onClick={() => removeEval(e.id)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {evs.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    해당하는 제출본이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>총괄표</h3>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>과목</th>
                <th style={{ width: 80 }}>위원 수</th>
                <th style={{ width: 80 }}>상태</th>
                <th style={{ width: 104 }}>확정</th>
                <th style={{ width: 240 }}></th>
              </tr>
            </thead>
            <tbody>
              {sums.map((s) => (
                <tr key={s.id}>
                  <td>{subjName(s.subjectId)}</td>
                  <td>{s.memberColumns.length}</td>
                  <td>{s.status === 'finalized' ? <span className="badge ok">확정</span> : <span className="badge warn">작성 중</span>}</td>
                  <td className="small">{s.finalizedAt ? fmtDate(s.finalizedAt) : '-'}</td>
                  <td>
                    <button className="btn sm" onClick={() => exportOne(`총괄표_${subjName(s.subjectId)}.json`, s)}>
                      내려받기
                    </button>{' '}
                    {s.status === 'finalized' && (
                      <button className="btn sm" onClick={() => unfinalize(s.id)}>
                        확정 취소
                      </button>
                    )}{' '}
                    <button className="btn sm danger" onClick={() => removeSummary(s.id)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {sums.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    생성된 총괄표가 없습니다.
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
