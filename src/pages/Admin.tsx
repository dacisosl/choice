import { useMemo, useState } from 'react'
import type { CommitteeMember, Criterion, Master, OpinionOption, Publisher, Settings, Subject } from '../types'
import { DEFAULT_CRITERIA, SAMPLE_PUBLISHERS, uid } from '../seed'
import { fmtDate, useAppData } from '../store/useAppData'
import { columnTotal, criteriaFor, publishersFor } from '../lib/scoring'
import { getApiKey, setApiKey } from '../lib/ai'
import { downloadText, parseCsv, readFileText, toCsv } from '../lib/csv'
import { getAppCheckState, getSupabaseOverride, setSupabaseOverride } from '../store/storage'

const TABS = ['과목·출판사', '평가기준', '의견 선택지', '위원 명단', '설정·현황']

export function Admin() {
  const [tab, setTab] = useState(0)
  return (
    <div>
      <div className="tabs">
        {TABS.map((t, i) => (
          <button key={t} className={i === tab ? 'active' : ''} onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 0 && <SubjectsTab />}
      {tab === 1 && <CriteriaTab />}
      {tab === 2 && <OptionsTab />}
      {tab === 3 && <CommitteeTab />}
      {tab === 4 && <SettingsTab />}
    </div>
  )
}

function useMasterEdit() {
  const { master, saveMaster } = useAppData()
  const [msg, setMsg] = useState<{ type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null>(null)
  const save = async (m: Master, text = '저장되었습니다.') => {
    try {
      await saveMaster(m)
      setMsg({ type: 'ok', text })
    } catch (e) {
      setMsg({ type: 'error', text: `저장 실패: ${(e as Error).message}` })
    }
  }
  return { master, save, msg, setMsg }
}

// ───────────── A1 과목·출판사 ─────────────
function SubjectsTab() {
  const { master, save, msg, setMsg } = useMasterEdit()
  const { evaluations } = useAppData()
  const [sel, setSel] = useState('')
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [newGrade, setNewGrade] = useState<'1·2' | '3'>('3')
  const subject = master.subjects.find((s) => s.id === sel)
  const pubs = subject ? publishersFor(master, subject.id) : []

  const setPubs = (subjectId: string, list: Publisher[]) => {
    const others = master.publishers.filter((p) => p.subjectId !== subjectId)
    return save({ ...master, publishers: [...others, ...list.map((p, i) => ({ ...p, order: i + 1 }))] })
  }
  const addPub = () => subject && setPubs(subject.id, [...pubs, { id: uid(), subjectId: subject.id, name: '', order: pubs.length + 1 }])
  const fillSample = (all: boolean) => {
    const targets = all ? master.subjects : subject ? [subject] : []
    if (!targets.length) return
    if (!confirm(`${all ? '모든 과목' : subject!.name}에 테스트용 예시 출판사를 채울까요? 기존 출판사가 없는 과목만 채워집니다.`)) return
    const add: Publisher[] = []
    let seed = 3
    for (const s of targets) {
      if (master.publishers.some((p) => p.subjectId === s.id)) continue
      const n = 3 + (seed++ % 4)
      SAMPLE_PUBLISHERS.slice(0, n).forEach((name, i) => add.push({ id: uid(), subjectId: s.id, name, order: i + 1 }))
    }
    save({ ...master, publishers: [...master.publishers, ...add] }, `${add.length}개 출판사를 추가했습니다.`)
  }
  const importCsv = async (file: File | null, kind: 'subjects' | 'publishers') => {
    if (!file) return
    const rows = parseCsv(await readFileText(file))
    if (rows.length && /과목|학년|출판사/.test(rows[0].join(''))) rows.shift()
    if (kind === 'subjects') {
      const subs = [...master.subjects]
      let n = 0
      for (const [grade, group, name] of rows) {
        if (!name || subs.some((s) => s.name === name)) continue
        subs.push({ id: uid(), name, gradeGroup: grade.includes('3') ? '3' : '1·2', subjectGroup: group, status: 'open' })
        n++
      }
      save({ ...master, subjects: subs }, `과목 ${n}개 추가`)
    } else {
      const pubsAll = [...master.publishers]
      let n = 0
      let miss = 0
      for (const [subjName, pubName, order, price] of rows) {
        const s = master.subjects.find((x) => x.name === subjName)
        if (!s || !pubName) {
          miss++
          continue
        }
        if (pubsAll.some((p) => p.subjectId === s.id && p.name === pubName)) continue
        pubsAll.push({ id: uid(), subjectId: s.id, name: pubName, order: Number(order) || pubsAll.filter((p) => p.subjectId === s.id).length + 1, price: price || undefined })
        n++
      }
      save({ ...master, publishers: pubsAll }, `출판사 ${n}개 추가${miss ? `, 과목을 찾지 못한 행 ${miss}개` : ''}`)
    }
  }
  const addSubject = () => {
    if (!newName.trim()) return
    save({ ...master, subjects: [...master.subjects, { id: uid(), name: newName.trim(), gradeGroup: newGrade, subjectGroup: newGroup.trim() || '기타', status: 'open' }] })
    setNewName('')
  }
  const removeSubject = (s: Subject) => {
    if (evaluations.some((e) => e.subjectId === s.id)) return setMsg({ type: 'warn', text: '제출 문서가 있는 과목은 삭제할 수 없습니다.' })
    if (!confirm(`${s.name} 과목을 삭제할까요?`)) return
    save({ ...master, subjects: master.subjects.filter((x) => x.id !== s.id), publishers: master.publishers.filter((p) => p.subjectId !== s.id), criteria: master.criteria.filter((c) => c.subjectId !== s.id) })
    if (sel === s.id) setSel('')
  }

  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div className="grid2">
        <div className="card">
          <h2>과목 ({master.subjects.length})</h2>
          <div className="actions" style={{ marginTop: 0, marginBottom: 8 }}>
            <label className="btn sm">
              과목 CSV 업로드 (학년,교과,과목명)
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => importCsv(e.target.files?.[0] || null, 'subjects')} />
            </label>
            <button className="btn sm" onClick={() => fillSample(true)}>
              전 과목 예시 출판사 채우기(테스트)
            </button>
          </div>
          <div className="scroll-x" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>학년</th>
                  <th>교과</th>
                  <th>과목</th>
                  <th>출판사</th>
                  <th>상태</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {master.subjects.map((s) => {
                  const n = master.publishers.filter((p) => p.subjectId === s.id).length
                  return (
                    <tr key={s.id} style={{ background: s.id === sel ? '#eef3fc' : undefined }}>
                      <td>{s.gradeGroup}</td>
                      <td>{s.subjectGroup}</td>
                      <td style={{ cursor: 'pointer', color: 'var(--primary)' }} onClick={() => setSel(s.id)}>
                        {s.name}
                      </td>
                      <td>{n === 0 ? <span className="badge warn">0</span> : n === 1 ? <span className="badge gray">1책1도서</span> : n}</td>
                      <td>
                        <button className={`btn sm ${s.status === 'closed' ? '' : ''}`} onClick={() => save({ ...master, subjects: master.subjects.map((x) => (x.id === s.id ? { ...x, status: x.status === 'open' ? 'closed' : 'open' } : x)) })}>
                          {s.status === 'open' ? '진행' : '마감'}
                        </button>
                      </td>
                      <td>
                        <button className="btn sm danger" onClick={() => removeSubject(s)}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <select value={newGrade} onChange={(e) => setNewGrade(e.target.value as '1·2' | '3')} style={{ flex: '0 0 80px' }}>
              <option value="1·2">1·2</option>
              <option value="3">3</option>
            </select>
            <input type="text" placeholder="교과 (예: 수학)" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
            <input type="text" placeholder="과목명" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSubject()} />
            <button className="btn" onClick={addSubject} style={{ flex: '0 0 auto' }}>
              과목 추가
            </button>
          </div>
        </div>
        <div className="card">
          <h2>출판사 {subject && <span className="muted small">— {subject.name}</span>}</h2>
          {!subject && <p className="muted small">왼쪽 표에서 과목명을 클릭하세요.</p>}
          <div className="actions" style={{ marginTop: 0, marginBottom: 8 }}>
            <label className="btn sm">
              출판사 CSV 업로드 (과목명,출판사명,순서,정가)
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => importCsv(e.target.files?.[0] || null, 'publishers')} />
            </label>
            <button className="btn sm" onClick={() => downloadText('publishers_template.csv', toCsv([['과목명', '출판사명', '순서', '정가'], ['세계사', '비상교육', '1', '12000']]), 'text/csv')}>
              CSV 서식 내려받기
            </button>
          </div>
          {subject && (
            <>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>출판사명</th>
                    <th style={{ width: 90 }}>정가</th>
                    <th style={{ width: 120 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pubs.map((p, i) => (
                    <tr key={p.id}>
                      <td>{i + 1}</td>
                      <td>
                        <input type="text" value={p.name} onChange={(e) => setPubs(subject.id, pubs.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))} />
                      </td>
                      <td>
                        <input type="text" value={p.price || ''} onChange={(e) => setPubs(subject.id, pubs.map((x) => (x.id === p.id ? { ...x, price: e.target.value } : x)))} />
                      </td>
                      <td>
                        <button className="btn sm" disabled={i === 0} onClick={() => { const l = [...pubs]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; setPubs(subject.id, l) }}>
                          ↑
                        </button>{' '}
                        <button className="btn sm" disabled={i === pubs.length - 1} onClick={() => { const l = [...pubs]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; setPubs(subject.id, l) }}>
                          ↓
                        </button>{' '}
                        <button className="btn sm danger" onClick={() => setPubs(subject.id, pubs.filter((x) => x.id !== p.id))}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="actions">
                <button className="btn" onClick={addPub}>
                  출판사 추가
                </button>
                <button className="btn" onClick={() => fillSample(false)} disabled={pubs.length > 0}>
                  예시 채우기(테스트)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ───────────── A2 평가기준 ─────────────
function CriteriaTab() {
  const { master, save, msg, setMsg } = useMasterEdit()
  const [scope, setScope] = useState<string>('default')
  const subjectId = scope === 'default' ? null : scope
  const own = master.criteria.filter((c) => c.subjectId === subjectId).sort((a, b) => a.order - b.order)
  const isOverride = subjectId !== null && own.length > 0
  const list = subjectId === null ? own : isOverride ? own : []
  const total = list.reduce((s, c) => s + c.points, 0)

  const setList = (next: Criterion[]) => {
    if (next.reduce((s, c) => s + c.points, 0) !== 100) {
      setMsg({ type: 'warn', text: `배점 합계가 100이 아닙니다 (현재 ${next.reduce((s, c) => s + c.points, 0)}). 합계가 100이 되어야 저장됩니다.` })
    }
    const others = master.criteria.filter((c) => c.subjectId !== subjectId)
    const merged = [...others, ...next.map((c, i) => ({ ...c, order: i + 1 }))]
    // 합계가 100이 아니어도 편집 중 상태 유지를 위해 저장은 하되 경고 표시
    save({ ...master, criteria: merged }, next.reduce((s, c) => s + c.points, 0) === 100 ? '저장되었습니다.' : '저장됨 (배점 합계 100 확인 필요)')
  }
  const createOverride = () => {
    if (!subjectId) return
    const base = master.criteria.filter((c) => c.subjectId === null).sort((a, b) => a.order - b.order)
    setList(base.map((c) => ({ ...c, id: uid(), subjectId })))
  }
  const removeOverride = () => {
    if (!subjectId || !confirm('과목 전용 기준을 삭제하고 기본 템플릿을 사용할까요?')) return
    save({ ...master, criteria: master.criteria.filter((c) => c.subjectId !== subjectId) })
  }
  const resetDefault = () => {
    if (!confirm('기본 템플릿을 초기값으로 되돌릴까요?')) return
    save({ ...master, criteria: [...master.criteria.filter((c) => c.subjectId !== null), ...DEFAULT_CRITERIA.map((c, i) => ({ ...c, id: `crit-default-${i + 1}`, subjectId: null }))] })
  }
  const importCsv = async (file: File | null) => {
    if (!file) return
    const rows = parseCsv(await readFileText(file))
    if (rows.length && /과목|영역|배점/.test(rows[0].join(''))) rows.shift()
    const bySubject = new Map<string | null, Criterion[]>()
    for (const [subj, area, text, pts] of rows) {
      const sid = !subj || subj === '기본' ? null : master.subjects.find((s) => s.name === subj)?.id
      if (sid === undefined) continue
      const arr = bySubject.get(sid) || []
      arr.push({ id: uid(), subjectId: sid, area, text, points: Number(pts) || 0, locked: /가격|재정/.test(area), order: arr.length + 1 })
      bySubject.set(sid, arr)
    }
    let crit = [...master.criteria]
    for (const [sid, arr] of bySubject) crit = [...crit.filter((c) => c.subjectId !== sid), ...arr]
    save({ ...master, criteria: crit }, `${bySubject.size}개 기준 세트 반영`)
  }

  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div className="card">
        <div className="row">
          <label className="field">
            대상
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="default">기본 템플릿 (전 과목 공통)</option>
              {master.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {master.criteria.some((c) => c.subjectId === s.id) ? ' (전용 기준 있음)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="actions" style={{ marginTop: 0, flex: '2 1 auto' }}>
            <label className="btn sm">
              기준 CSV 업로드 (과목명 또는 '기본',평가영역,평가기준,배점)
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => importCsv(e.target.files?.[0] || null)} />
            </label>
            {subjectId === null && (
              <button className="btn sm" onClick={resetDefault}>
                기본값으로 되돌리기
              </button>
            )}
            {subjectId !== null && !isOverride && (
              <button className="btn sm primary" onClick={createOverride}>
                이 과목 전용 기준 만들기 (기본 복사)
              </button>
            )}
            {isOverride && (
              <button className="btn sm danger" onClick={removeOverride}>
                전용 기준 삭제 (기본으로 복귀)
              </button>
            )}
          </div>
        </div>
        {subjectId !== null && !isOverride && <p className="note">이 과목은 기본 템플릿을 사용합니다. 과목별로 다르게 하려면 전용 기준을 만드세요.</p>}
        {(subjectId === null || isOverride) && (
          <>
            <table className="data" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th style={{ width: 180 }}>평가영역</th>
                  <th>평가기준</th>
                  <th style={{ width: 80 }}>배점</th>
                  <th style={{ width: 140 }}></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c, i) => (
                  <tr key={c.id}>
                    <td>
                      <input type="text" value={c.area} onChange={(e) => setList(list.map((x) => (x.id === c.id ? { ...x, area: e.target.value } : x)))} />
                    </td>
                    <td>
                      <input type="text" value={c.text} onChange={(e) => setList(list.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))} />
                    </td>
                    <td>
                      <input type="number" value={c.points} min={0} max={100} onChange={(e) => setList(list.map((x) => (x.id === c.id ? { ...x, points: Number(e.target.value) || 0 } : x)))} />
                    </td>
                    <td>
                      <button className="btn sm" disabled={i === 0} onClick={() => { const l = [...list]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; setList(l) }}>
                        ↑
                      </button>{' '}
                      <button className="btn sm" disabled={i === list.length - 1} onClick={() => { const l = [...list]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; setList(l) }}>
                        ↓
                      </button>{' '}
                      {c.locked ? (
                        <span className="badge info" title="계획서 방침에 따라 가격·재정 항목은 삭제할 수 없습니다">
                          필수
                        </span>
                      ) : (
                        <button className="btn sm danger" onClick={() => setList(list.filter((x) => x.id !== c.id))}>
                          삭제
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th colSpan={2} style={{ textAlign: 'right' }}>
                    합계
                  </th>
                  <th style={{ color: total === 100 ? 'var(--ok)' : 'var(--danger)' }}>{total}</th>
                  <th>{total !== 100 && <span className="badge warn">100이어야 함</span>}</th>
                </tr>
              </tbody>
            </table>
            <div className="actions">
              <button className="btn" onClick={() => setList([...list, { id: uid(), subjectId, area: '', text: '', points: 0, locked: false, order: list.length + 1 }])}>
                기준 추가
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ───────────── A3 의견 선택지 ─────────────
function OptionsTab() {
  const { master, save, msg } = useMasterEdit()
  const [scope, setScope] = useState<'summary' | 'recommend'>('summary')
  const list = master.opinionOptions.filter((o) => o.scope === scope).sort((a, b) => a.order - b.order)
  const groups = Array.from(new Set(master.subjects.map((s) => s.subjectGroup)))
  const setOpt = (o: OpinionOption) => save({ ...master, opinionOptions: master.opinionOptions.map((x) => (x.id === o.id ? o : x)) })
  const add = () => save({ ...master, opinionOptions: [...master.opinionOptions, { id: uid(), scope, category: '기타', label: '', subjectGroup: null, order: (Math.max(0, ...master.opinionOptions.map((o) => o.order)) || 0) + 1 }] })
  const copyToOther = () => {
    const other = scope === 'summary' ? 'recommend' : 'summary'
    if (!confirm(`현재 목록을 ${other === 'summary' ? '종합의견' : '추천의견'} 선택지로 복사(덮어쓰기)할까요?`)) return
    const copied = list.map((o) => ({ ...o, id: uid(), scope: other as 'summary' | 'recommend' }))
    save({ ...master, opinionOptions: [...master.opinionOptions.filter((o) => o.scope !== other), ...copied] })
  }
  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div className="card">
        <div className="actions" style={{ marginTop: 0 }}>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'summary' | 'recommend')}>
            <option value="summary">종합의견 (서식1 하단)</option>
            <option value="recommend">추천의견 (서식3)</option>
          </select>
          <button className="btn" onClick={add}>
            항목 추가
          </button>
          <button className="btn" onClick={copyToOther}>
            다른 용도로 복사
          </button>
        </div>
        <table className="data" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th style={{ width: 140 }}>카테고리</th>
              <th>항목</th>
              <th style={{ width: 130 }}>교과군 (공통=빈칸)</th>
              <th style={{ width: 80 }}>아쉬운 점</th>
              <th style={{ width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id}>
                <td>
                  <input type="text" value={o.category} onChange={(e) => setOpt({ ...o, category: e.target.value })} />
                </td>
                <td>
                  <input type="text" value={o.label} onChange={(e) => setOpt({ ...o, label: e.target.value })} />
                </td>
                <td>
                  <select value={o.subjectGroup || ''} onChange={(e) => setOpt({ ...o, subjectGroup: e.target.value || null })}>
                    <option value="">공통</option>
                    {groups.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={!!o.negative} onChange={(e) => setOpt({ ...o, negative: e.target.checked })} />
                </td>
                <td>
                  <button className="btn sm danger" onClick={() => save({ ...master, opinionOptions: master.opinionOptions.filter((x) => x.id !== o.id) })}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ───────────── A3-2 위원 명단 ─────────────
function CommitteeTab() {
  const { master, save, msg } = useMasterEdit()
  const [subjectId, setSubjectId] = useState('')
  const list = master.committee.filter((c) => c.subjectId === subjectId)
  const setList = (next: CommitteeMember[]) => save({ ...master, committee: [...master.committee.filter((c) => c.subjectId !== subjectId), ...next] })
  const importCsv = async (file: File | null) => {
    if (!file) return
    const rows = parseCsv(await readFileText(file))
    if (rows.length && /과목|위원|교사/.test(rows[0].join(''))) rows.shift()
    const add: CommitteeMember[] = []
    for (const [subj, name, role] of rows) {
      const s = master.subjects.find((x) => x.name === subj)
      if (!s || !name) continue
      add.push({ id: uid(), subjectId: s.id, teacherName: name, role: /대표/.test(role || '') ? 'lead' : /총괄/.test(role || '') ? 'compiler' : 'member' })
    }
    save({ ...master, committee: [...master.committee, ...add] }, `${add.length}명 추가`)
  }
  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div className="card">
        <p className="muted small">선택 사항입니다. 위원 명단을 등록하면 총괄 화면의 제출 현황판에 미제출 위원이 표시됩니다.</p>
        <div className="row">
          <label className="field">
            과목
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">과목 선택</option>
              {master.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({master.committee.filter((c) => c.subjectId === s.id).length}명)
                </option>
              ))}
            </select>
          </label>
          <label className="btn" style={{ flex: '0 0 auto' }}>
            위원 CSV 업로드 (과목명,위원명,역할)
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => importCsv(e.target.files?.[0] || null)} />
          </label>
        </div>
        {subjectId && (
          <>
            <table className="data" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>위원명</th>
                  <th style={{ width: 140 }}>역할</th>
                  <th style={{ width: 70 }}></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input type="text" value={c.teacherName} onChange={(e) => setList(list.map((x) => (x.id === c.id ? { ...x, teacherName: e.target.value } : x)))} />
                    </td>
                    <td>
                      <select value={c.role} onChange={(e) => setList(list.map((x) => (x.id === c.id ? { ...x, role: e.target.value as CommitteeMember['role'] } : x)))}>
                        <option value="member">위원</option>
                        <option value="lead">대표교사</option>
                        <option value="compiler">총괄 작성</option>
                      </select>
                    </td>
                    <td>
                      <button className="btn sm danger" onClick={() => setList(list.filter((x) => x.id !== c.id))}>
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions">
              <button className="btn" onClick={() => setList([...list, { id: uid(), subjectId, teacherName: '', role: 'member' }])}>
                위원 추가
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ───────────── A4 설정·현황 ─────────────
function SettingsTab() {
  const { master, save, msg, setMsg } = useMasterEdit()
  const { evaluations, summaries, mode, config, resetMaster, saveEvaluation, saveSummary } = useAppData()
  const [s, setS] = useState<Settings>(master.settings)
  const [apiKey, setKey] = useState(getApiKey())
  const appCheck = getAppCheckState()
  const ov = getSupabaseOverride()
  const [sbUrl, setSbUrl] = useState(ov?.url || config.supabaseUrl || '')
  const [sbKey, setSbKey] = useState(ov?.key || config.supabaseAnonKey || '')

  const progress = useMemo(
    () =>
      master.subjects.map((sub) => {
        const evs = evaluations.filter((e) => e.subjectId === sub.id)
        const sum = summaries.find((x) => x.subjectId === sub.id)
        return { sub, pubs: master.publishers.filter((p) => p.subjectId === sub.id).length, drafts: evs.filter((e) => e.status === 'draft').length, submitted: evs.filter((e) => e.status === 'submitted').length, sum }
      }),
    [master, evaluations, summaries],
  )

  const exportBackup = () => downloadText(`choice_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ master, evaluations, summaries }, null, 2), 'application/json')
  const importBackup = async (file: File | null) => {
    if (!file) return
    try {
      const data = JSON.parse(await readFileText(file)) as { master?: Master; evaluations?: typeof evaluations; summaries?: typeof summaries }
      if (!confirm('백업을 불러오면 마스터 데이터가 덮어써지고 문서는 병합됩니다. 계속할까요?')) return
      if (data.master) await save(data.master, '마스터 데이터 복원')
      for (const e of data.evaluations || []) await saveEvaluation(e)
      for (const x of data.summaries || []) await saveSummary(x)
      setMsg({ type: 'ok', text: '백업을 불러왔습니다.' })
    } catch (e) {
      setMsg({ type: 'error', text: `불러오기 실패: ${(e as Error).message}` })
    }
  }
  const exportScoresCsv = () => {
    const rows: (string | number)[][] = [['과목', '위원', '상태', '출판사', '합계', '제출일시']]
    for (const e of evaluations) {
      const sub = master.subjects.find((x) => x.id === e.subjectId)
      if (!sub) continue
      const crit = criteriaFor(master, sub.id)
      for (const p of publishersFor(master, sub.id)) rows.push([sub.name, e.teacherName, e.status, p.name, columnTotal(e.scores[p.id], crit), e.submittedAt || ''])
    }
    downloadText('scores.csv', toCsv(rows), 'text/csv')
  }

  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div className="grid2">
        <div className="card">
          <h2>학교·문서 설정</h2>
          <div className="row">
            <label className="field">
              학교명
              <input type="text" value={s.schoolName} onChange={(e) => setS({ ...s, schoolName: e.target.value })} />
            </label>
            <label className="field">
              학년도
              <input type="number" value={s.year} onChange={(e) => setS({ ...s, year: Number(e.target.value) })} />
            </label>
          </div>
          <div className="row">
            <label className="field">
              AI 문체
              <select value={s.tone} onChange={(e) => setS({ ...s, tone: e.target.value as Settings['tone'] })}>
                <option value="formal">개조식 (~함/~됨)</option>
                <option value="plain">서술식 (~합니다)</option>
              </select>
            </label>
            <label className="field">
              서식2 위원 열 표기
              <select value={s.memberHeaderMode} onChange={(e) => setS({ ...s, memberHeaderMode: e.target.value as Settings['memberHeaderMode'] })}>
                <option value="name">실명</option>
                <option value="number">위원1, 위원2…</option>
              </select>
            </label>
            <label className="field">
              평균 소수 자릿수
              <input type="number" min={0} max={2} value={s.averageDecimals} onChange={(e) => setS({ ...s, averageDecimals: Number(e.target.value) })} />
            </label>
          </div>
          <h3 style={{ marginTop: 12 }}>순위별 초안 목표 총점</h3>
          <div className="row">
            {(['r1', 'r2', 'r3', 'other'] as const).map((k) => (
              <label className="field" key={k}>
                {k === 'r1' ? '1순위' : k === 'r2' ? '2순위' : k === 'r3' ? '3순위' : '순위 밖'}
                <input type="number" value={s.targetScores[k]} onChange={(e) => setS({ ...s, targetScores: { ...s.targetScores, [k]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
            <input type="checkbox" checked={s.jitter} onChange={(e) => setS({ ...s, jitter: e.target.checked })} /> ±1점 흔들림 (위원 간 완전 동일 점수 방지)
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <input type="checkbox" checked={s.printPersonalRecommend} onChange={(e) => setS({ ...s, printPersonalRecommend: e.target.checked })} /> 개인 추천의견(서식3형)도 인쇄에 포함
          </label>
          <h3 style={{ marginTop: 12 }}>접속 코드</h3>
          <div className="row">
            <label className="field">
              공용 접속 코드 (빈칸=없음)
              <input type="text" value={s.accessCode} onChange={(e) => setS({ ...s, accessCode: e.target.value })} />
            </label>
            <label className="field">
              총괄 코드 (빈칸=공용 코드)
              <input type="text" value={s.compilerCode} onChange={(e) => setS({ ...s, compilerCode: e.target.value })} />
            </label>
            <label className="field">
              관리 코드
              <input type="text" value={s.adminCode} onChange={(e) => setS({ ...s, adminCode: e.target.value })} />
            </label>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => save({ ...master, settings: s })}>
              설정 저장
            </button>
          </div>
        </div>

        <div className="card">
          <h2>AI 문장 생성 (OpenRouter)</h2>
          <p className="muted small">API 키는 이 브라우저에만 저장됩니다(공유 DB에 저장되지 않음). 키가 없으면 규칙 기반 문장으로 자동 대체됩니다.</p>
          <label className="field">
            OpenRouter API 키
            <input type="password" value={apiKey} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-v1-…" />
          </label>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="field">
              기본 모델
              <input type="text" value={s.aiModel} onChange={(e) => setS({ ...s, aiModel: e.target.value })} />
            </label>
            <label className="field">
              폴백 모델
              <input type="text" value={s.aiFallbackModel} onChange={(e) => setS({ ...s, aiFallbackModel: e.target.value })} />
            </label>
            <label className="field">
              문서당 생성 상한
              <input type="number" value={s.aiMaxPerDoc} onChange={(e) => setS({ ...s, aiMaxPerDoc: Number(e.target.value) })} />
            </label>
          </div>
          <div className="actions">
            <button
              className="btn primary"
              onClick={() => {
                setApiKey(apiKey.trim())
                save({ ...master, settings: s }, 'AI 설정을 저장했습니다.')
              }}
            >
              AI 설정 저장
            </button>
          </div>

          <h2 style={{ marginTop: 20 }}>
            데이터 저장 방식 <span className={`badge ${mode !== 'local' ? 'ok' : 'warn'}`}>{mode === 'supabase' ? '온라인 공유 (Supabase)' : mode === 'firebase' ? '온라인 공유 (Firebase)' : '이 브라우저만'}</span>
          </h2>
          <p className="muted small">
            여러 교사가 함께 쓰려면 Supabase 또는 Firebase 프로젝트를 만들고 저장소의 <code>public/config.json</code>에 연결 정보를 넣어 배포하세요(README 참고). 아래 Supabase 입력은 이 브라우저에서만 임시로 덮어씁니다.
          </p>
          {mode === 'firebase' && (
            <p className="small" style={{ marginTop: -2 }}>
              App Check{' '}
              {appCheck === 'on' ? (
                <span className="badge ok">작동 중</span>
              ) : appCheck === 'failed' ? (
                <span className="badge warn">초기화 실패 — 사이트 키·등록 도메인 확인</span>
              ) : (
                <span className="badge gray">꺼짐 — config.json에 사이트 키 미입력</span>
              )}{' '}
              <span className="muted">외부에서의 직접 접근을 차단합니다.</span>
            </p>
          )}
          <label className="field">
            Supabase URL
            <input type="text" value={sbUrl} onChange={(e) => setSbUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
          </label>
          <label className="field" style={{ marginTop: 6 }}>
            anon key
            <input type="password" value={sbKey} onChange={(e) => setSbKey(e.target.value)} />
          </label>
          <div className="actions">
            <button
              className="btn"
              onClick={() => {
                setSupabaseOverride(sbUrl && sbKey ? { url: sbUrl.trim(), key: sbKey.trim() } : null)
                location.reload()
              }}
            >
              적용 후 새로고침
            </button>
            {ov && (
              <button
                className="btn"
                onClick={() => {
                  setSupabaseOverride(null)
                  location.reload()
                }}
              >
                덮어쓰기 해제
              </button>
            )}
          </div>

          <h2 style={{ marginTop: 20 }}>백업·내보내기</h2>
          <div className="actions" style={{ marginTop: 0 }}>
            <button className="btn" onClick={exportBackup}>
              전체 백업(JSON)
            </button>
            <label className="btn">
              백업 불러오기
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => importBackup(e.target.files?.[0] || null)} />
            </label>
            <button className="btn" onClick={exportScoresCsv}>
              점수 내보내기(CSV)
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (confirm('과목·출판사·평가기준·선택지·설정을 초기값으로 되돌릴까요? (제출 문서는 유지)')) resetMaster()
              }}
            >
              마스터 초기화
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>과목별 진행 현황</h2>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>학년</th>
                <th>교과</th>
                <th>과목</th>
                <th>출판사</th>
                <th>작성 중</th>
                <th>제출</th>
                <th>총괄표</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {progress.map(({ sub, pubs, drafts, submitted, sum }) => (
                <tr key={sub.id}>
                  <td>{sub.gradeGroup}</td>
                  <td>{sub.subjectGroup}</td>
                  <td>{sub.name}</td>
                  <td>{pubs <= 1 ? <span className="muted">{pubs === 0 ? '미등록' : '1책1도서'}</span> : pubs}</td>
                  <td>{drafts || ''}</td>
                  <td>{submitted ? <strong>{submitted}</strong> : ''}</td>
                  <td>{sum ? (sum.status === 'finalized' ? <span className="badge ok">확정 {fmtDate(sum.finalizedAt)}</span> : <span className="badge warn">작성 중</span>) : ''}</td>
                  <td>{sub.status === 'closed' ? <span className="badge gray">마감</span> : '진행'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
