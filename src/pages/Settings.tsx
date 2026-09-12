import { useState } from 'react'
import type { Criterion, Master, Publisher, Subject } from '../types'
import { DEFAULT_CRITERIA, seedSubjects, uid } from '../seed'
import { useAppData } from '../store/useAppData'
import { publishersFor } from '../lib/scoring'
import { downloadText, parseCsv, readFileText, toCsv } from '../lib/csv'
import { normalizeSchoolId, schoolIdError } from '../store/school'

const TABS = ['담당자 로그인', '선정 과목 관리', '과목별 출판사 관리', '평가기준']
type Msg = { type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null

export function Settings({ go }: { go: (h: string) => void }) {
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
      {tab === 0 && <AccountTab go={go} />}
      {tab === 1 && <SubjectsTab />}
      {tab === 2 && <PublishersTab />}
      {tab === 3 && <CriteriaTab />}
    </div>
  )
}

function useMasterEdit() {
  const { master, saveMaster } = useAppData()
  const [msg, setMsg] = useState<Msg>(null)
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

/** 과목·출판사는 학교 담당자만 고칠 수 있다 (공유가 켜져 있을 때) */
function useSharedEditable() {
  const { schoolStatus, isOwner, accountEnabled } = useAppData()
  const shared = schoolStatus === 'ok'
  return { shared, canEdit: !shared || isOwner, accountEnabled, isOwner }
}

function SharedNotice() {
  const { shared, canEdit } = useSharedEditable()
  if (!shared || canEdit) return null
  return (
    <div className="alert info">
      이 학교의 과목·출판사 목록입니다. 담당 선생님 계정으로 로그인해야 고칠 수 있습니다. (설정 › 학교 계정)
    </div>
  )
}

// ───────────── ① 선정 과목 관리 ─────────────
function SubjectsTab() {
  const { master, save, msg, setMsg } = useMasterEdit()
  const { canEdit } = useSharedEditable()
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [newGrade, setNewGrade] = useState<'1·2' | '3'>('3')
  const [bulk, setBulk] = useState('')
  const [showBulk, setShowBulk] = useState(false)

  const setSubjects = (list: Subject[], text?: string) => save({ ...master, subjects: list }, text)

  const addSubject = () => {
    if (!newName.trim()) return
    if (master.subjects.some((s) => s.name === newName.trim())) return setMsg({ type: 'warn', text: '같은 이름의 과목이 이미 있습니다.' })
    setSubjects([...master.subjects, { id: uid(), name: newName.trim(), gradeGroup: newGrade, subjectGroup: newGroup.trim() || '기타' }], `${newName.trim()} 과목을 추가했습니다.`)
    setNewName('')
  }

  /** 여러 줄 붙여넣기: "과목명" 또는 "학년,교과,과목명" (쉼표·탭 모두 허용) */
  const addBulk = () => {
    const rows = bulk
      .split(/\r?\n/)
      .map((l) => l.split(/[,\t]/).map((x) => x.trim()))
      .filter((cols) => cols.some((c) => c))
    const next = [...master.subjects]
    let n = 0
    let dup = 0
    for (const cols of rows) {
      const [a, b, c] = cols
      const name = (c || b || a || '').trim()
      if (!name) continue
      if (next.some((s) => s.name === name)) {
        dup++
        continue
      }
      const grade = c || b ? (String(a).includes('3') ? '3' : '1·2') : newGrade
      const group = c ? b : b && !c ? a : newGroup.trim() || '기타'
      next.push({ id: uid(), name, gradeGroup: grade as Subject['gradeGroup'], subjectGroup: (group || '기타').trim() })
      n++
    }
    setSubjects(next, `과목 ${n}개를 추가했습니다.${dup ? ` (이미 있던 ${dup}개는 건너뜀)` : ''}`)
    setBulk('')
    setShowBulk(false)
  }

  const importCsv = async (file: File | null) => {
    if (!file) return
    const rows = parseCsv(await readFileText(file))
    if (rows.length && /과목|학년|교과/.test(rows[0].join(''))) rows.shift()
    const next = [...master.subjects]
    let n = 0
    for (const [grade, group, name] of rows) {
      if (!name || next.some((s) => s.name === name)) continue
      next.push({ id: uid(), name, gradeGroup: String(grade).includes('3') ? '3' : '1·2', subjectGroup: group || '기타' })
      n++
    }
    setSubjects(next, `과목 ${n}개를 추가했습니다.`)
  }

  const patch = (id: string, v: Partial<Subject>) => setSubjects(master.subjects.map((s) => (s.id === id ? { ...s, ...v } : s)))

  const removeSubject = (s: Subject) => {
    if (!confirm(`${s.name} 과목을 삭제할까요? 이 과목의 출판사 목록도 함께 지워집니다.`)) return
    save({
      ...master,
      subjects: master.subjects.filter((x) => x.id !== s.id),
      publishers: master.publishers.filter((p) => p.subjectId !== s.id),
      criteria: master.criteria.filter((c) => c.subjectId !== s.id),
    }, `${s.name} 과목을 삭제했습니다.`)
  }

  /** 계획서에 실린 과목 예시를 한 번에 채운다 (없는 과목만) */
  const loadExample = () => {
    if (!confirm('계획서 예시 과목 목록을 불러올까요? 이미 있는 과목은 그대로 둡니다.')) return
    const next = [...master.subjects]
    let n = 0
    for (const s of seedSubjects()) {
      if (next.some((x) => x.name === s.name)) continue
      next.push({ ...s, id: uid() })
      n++
    }
    setSubjects(next, `예시 과목 ${n}개를 넣었습니다. 필요 없는 과목은 삭제하세요.`)
  }

  const clearAll = () => {
    if (!confirm('등록된 과목을 모두 지울까요? 출판사 목록도 함께 지워집니다.')) return
    save({ ...master, subjects: [], publishers: [] }, '과목을 모두 지웠습니다.')
  }

  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <SharedNotice />
      <div className="card">
        <h2>선정 과목 ({master.subjects.length})</h2>
        {canEdit && (
          <>
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn primary" onClick={() => setShowBulk((v) => !v)}>
                {showBulk ? '목록 붙여넣기 닫기' : '목록으로 한꺼번에 추가'}
              </button>
              <label className="btn">
                엑셀·CSV 파일로 추가
                <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => importCsv(e.target.files?.[0] || null)} />
              </label>
              <button className="btn sm" onClick={() => downloadText('subjects_template.csv', toCsv([['학년', '교과', '과목명'], ['3', '사회', '세계사']]), 'text/csv')}>
                CSV 양식 내려받기
              </button>
              <button className="btn sm soft" onClick={loadExample}>
                예시 과목 목록 불러오기
              </button>
              <span className="spacer" />
              <button className="btn sm danger" onClick={clearAll} disabled={!master.subjects.length}>
                전체 지우기
              </button>
            </div>
            {showBulk && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  className="bulk-text"
                  rows={8}
                  value={bulk}
                  onChange={(e) => setBulk(e.target.value)}
                  placeholder={'한 줄에 과목 하나씩 붙여넣으세요.\n세계사\n정치\n또는 학년,교과,과목명 형식도 됩니다.\n3,사회,세계사'}
                />
                <div className="actions" style={{ marginTop: 6 }}>
                  <button className="btn primary" onClick={addBulk} disabled={!bulk.trim()}>
                    목록 추가하기
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="scroll-x" style={{ marginTop: 12, maxHeight: 520, overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 80 }}>학년</th>
                <th style={{ width: 140 }}>교과</th>
                <th>과목명</th>
                <th style={{ width: 80 }}>출판사</th>
                {canEdit && <th style={{ width: 70 }}></th>}
              </tr>
            </thead>
            <tbody>
              {master.subjects.map((s) => (
                <tr key={s.id}>
                  <td>
                    {canEdit ? (
                      <select value={s.gradeGroup} onChange={(e) => patch(s.id, { gradeGroup: e.target.value as Subject['gradeGroup'] })}>
                        <option value="1·2">1·2</option>
                        <option value="3">3</option>
                      </select>
                    ) : (
                      s.gradeGroup
                    )}
                  </td>
                  <td>{canEdit ? <input type="text" value={s.subjectGroup} onChange={(e) => patch(s.id, { subjectGroup: e.target.value })} /> : s.subjectGroup}</td>
                  <td>{canEdit ? <input type="text" value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })} /> : s.name}</td>
                  <td>{master.publishers.filter((p) => p.subjectId === s.id).length || <span className="badge warn">0</span>}</td>
                  {canEdit && (
                    <td>
                      <button className="btn sm danger" onClick={() => removeSubject(s)}>
                        삭제
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {master.subjects.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 5 : 4} className="muted">
                    등록된 과목이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="row" style={{ marginTop: 10 }}>
            <select value={newGrade} onChange={(e) => setNewGrade(e.target.value as '1·2' | '3')} style={{ flex: '0 0 80px' }}>
              <option value="1·2">1·2</option>
              <option value="3">3</option>
            </select>
            <input type="text" placeholder="교과 (예: 사회)" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
            <input type="text" placeholder="과목명" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSubject()} />
            <button className="btn" onClick={addSubject} style={{ flex: '0 0 auto' }}>
              개별 추가
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ───────────── ② 과목별 출판사 관리 ─────────────
function PublishersTab() {
  const { master, save, msg, setMsg } = useMasterEdit()
  const { canEdit } = useSharedEditable()
  const [sel, setSel] = useState('')
  const [bulk, setBulk] = useState('')
  const [newPub, setNewPub] = useState('')
  const subject = master.subjects.find((s) => s.id === sel)
  const pubs = subject ? publishersFor(master, subject.id) : []

  const setPubs = (subjectId: string, list: Publisher[], text?: string) => {
    const others = master.publishers.filter((p) => p.subjectId !== subjectId)
    return save({ ...master, publishers: [...others, ...list.map((p, i) => ({ ...p, order: i + 1 }))] }, text)
  }

  const addOne = () => {
    if (!subject || !newPub.trim()) return
    if (pubs.some((p) => p.name === newPub.trim())) return setMsg({ type: 'warn', text: '이미 있는 출판사입니다.' })
    setPubs(subject.id, [...pubs, { id: uid(), subjectId: subject.id, name: newPub.trim(), order: pubs.length + 1 }], `${newPub.trim()}을(를) 추가했습니다.`)
    setNewPub('')
  }

  /** 여러 줄 붙여넣기: 한 줄에 출판사 하나 (또는 "출판사명,정가") */
  const addBulk = () => {
    if (!subject) return
    const rows = bulk.split(/\r?\n/).map((l) => l.split(/[,\t]/).map((x) => x.trim())).filter((c) => c[0])
    const next = [...pubs]
    let n = 0
    for (const [name, price] of rows) {
      if (!name || next.some((p) => p.name === name)) continue
      next.push({ id: uid(), subjectId: subject.id, name, order: next.length + 1, price: price || undefined })
      n++
    }
    setPubs(subject.id, next, `출판사 ${n}개를 추가했습니다.`)
    setBulk('')
  }

  /** CSV: 과목명,출판사명,순서,정가 — 여러 과목을 한 번에 */
  const importCsv = async (file: File | null) => {
    if (!file) return
    const rows = parseCsv(await readFileText(file))
    if (rows.length && /과목|출판사/.test(rows[0].join(''))) rows.shift()
    const all = [...master.publishers]
    let n = 0
    let miss = 0
    for (const [subjName, pubName, order, price] of rows) {
      const s = master.subjects.find((x) => x.name === subjName)
      if (!s || !pubName) {
        miss++
        continue
      }
      if (all.some((p) => p.subjectId === s.id && p.name === pubName)) continue
      all.push({ id: uid(), subjectId: s.id, name: pubName, order: Number(order) || all.filter((p) => p.subjectId === s.id).length + 1, price: price || undefined })
      n++
    }
    save({ ...master, publishers: all }, `출판사 ${n}개를 추가했습니다.${miss ? ` (과목을 찾지 못한 줄 ${miss}개)` : ''}`)
  }

  const patch = (id: string, v: Partial<Publisher>) => subject && setPubs(subject.id, pubs.map((p) => (p.id === id ? { ...p, ...v } : p)))
  const move = (i: number, d: -1 | 1) => {
    if (!subject) return
    const l = [...pubs]
    ;[l[i + d], l[i]] = [l[i], l[i + d]]
    setPubs(subject.id, l)
  }

  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <SharedNotice />
      <div className="card">
        <h2>과목별 출판사</h2>
        <div className="row">
          <label className="field">
            과목 선택
            <select value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="">과목을 고르세요</option>
              {master.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({master.publishers.filter((p) => p.subjectId === s.id).length}곳)
                </option>
              ))}
            </select>
          </label>
          {canEdit && (
            <div className="actions" style={{ marginTop: 0, flex: '1 1 auto' }}>
              <label className="btn">
                엑셀·CSV로 한꺼번에 추가
                <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => importCsv(e.target.files?.[0] || null)} />
              </label>
              <button className="btn sm" onClick={() => downloadText('publishers_template.csv', toCsv([['과목명', '출판사명', '순서', '정가'], ['세계사', '비상교육', '1', '12000']]), 'text/csv')}>
                CSV 양식 내려받기
              </button>
            </div>
          )}
        </div>

        {!subject && <p className="muted small">과목을 고르면 그 과목의 출판사를 등록·수정할 수 있습니다.</p>}

        {subject && (
          <>
            <table className="data" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>출판사명</th>
                  <th style={{ width: 100 }}>정가</th>
                  {canEdit && <th style={{ width: 150 }}></th>}
                </tr>
              </thead>
              <tbody>
                {pubs.map((p, i) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td>{canEdit ? <input type="text" value={p.name} onChange={(e) => patch(p.id, { name: e.target.value })} /> : p.name}</td>
                    <td>{canEdit ? <input type="text" value={p.price || ''} onChange={(e) => patch(p.id, { price: e.target.value })} /> : p.price || ''}</td>
                    {canEdit && (
                      <td>
                        <button className="btn sm" disabled={i === 0} onClick={() => move(i, -1)}>
                          ↑
                        </button>{' '}
                        <button className="btn sm" disabled={i === pubs.length - 1} onClick={() => move(i, 1)}>
                          ↓
                        </button>{' '}
                        <button className="btn sm danger" onClick={() => setPubs(subject.id, pubs.filter((x) => x.id !== p.id), '삭제했습니다.')}>
                          삭제
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {pubs.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 4 : 3} className="muted">
                      등록된 출판사가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {canEdit && (
              <>
                <div className="row" style={{ marginTop: 10 }}>
                  <input type="text" placeholder="출판사명" value={newPub} onChange={(e) => setNewPub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOne()} />
                  <button className="btn" onClick={addOne} style={{ flex: '0 0 auto' }}>
                    개별 추가
                  </button>
                </div>
                <h3 style={{ marginTop: 14 }}>목록으로 한꺼번에 추가</h3>
                <textarea
                  className="bulk-text"
                  rows={5}
                  value={bulk}
                  onChange={(e) => setBulk(e.target.value)}
                  placeholder={'한 줄에 출판사 하나씩 붙여넣으세요.\n비상교육\n천재교육\n정가까지 넣으려면: 비상교육,12000'}
                />
                <div className="actions" style={{ marginTop: 6 }}>
                  <button className="btn primary" onClick={addBulk} disabled={!bulk.trim()}>
                    목록 추가하기
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ───────────── 평가기준 ─────────────
function CriteriaTab() {
  const { master, save, msg, setMsg } = useMasterEdit()
  const [scope, setScope] = useState<string>('default')
  const subjectId = scope === 'default' ? null : scope
  const own = master.criteria.filter((c) => c.subjectId === subjectId).sort((a, b) => a.order - b.order)
  const isOverride = subjectId !== null && own.length > 0
  const list = subjectId === null ? own : isOverride ? own : []
  const total = list.reduce((s, c) => s + c.points, 0)

  const setList = (next: Criterion[]) => {
    const sum = next.reduce((s, c) => s + c.points, 0)
    if (sum !== 100) setMsg({ type: 'warn', text: `배점 합계가 100이 아닙니다 (현재 ${sum}).` })
    const others = master.criteria.filter((c) => c.subjectId !== subjectId)
    save({ ...master, criteria: [...others, ...next.map((c, i) => ({ ...c, order: i + 1 }))] }, sum === 100 ? '저장되었습니다.' : '저장됨 (배점 합계 100 확인 필요)')
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

  return (
    <div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div className="card">
        <p className="muted small">평가기준은 이 컴퓨터에만 저장됩니다. 학교 전체에 같은 기준을 쓰려면 [문서·AI 설정]의 내보내기 파일을 나눠 주세요.</p>
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
        {subjectId !== null && !isOverride && <p className="note">이 과목은 기본 템플릿을 사용합니다.</p>}
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

// ───────────── 학교 계정 ─────────────
function AccountTab({ go }: { go: (h: string) => void }) {
  const {
    accountEnabled,
    schoolStatus,
    schoolId,
    school,
    schoolError,
    user,
    isOwner,
    isSuperAdmin,
    busy,
    authError,
    attachSchool,
    detachSchool,
    signUp,
    changeSchoolId,
    signIn,
    signOut,
    sendReset,
    changePassword,
    deleteAccount,
    clearAuthError,
    master,
  } = useAppData()

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newSchoolId, setNewSchoolId] = useState('')
  const [newSchoolName, setNewSchoolName] = useState(master.settings.schoolName)
  const [agree, setAgree] = useState(false)
  const [joinId, setJoinId] = useState('')
  const [curPw, setCurPw] = useState('')
  const [nextPw, setNextPw] = useState('')
  const [delPw, setDelPw] = useState('')
  const [renameId, setRenameId] = useState('')
  const [renameMsg, setRenameMsg] = useState<Msg>(null)
  const [msg, setMsg] = useState<Msg>(null)

  if (!accountEnabled)
    return (
      <div className="card">
        <h2>학교 계정</h2>
        <p className="muted small">
          이 배포본에는 학교 계정 기능이 꺼져 있습니다(<code>public/config.json</code> 의 Firebase 설정 없음). 과목·출판사는 각 컴퓨터에서 직접 입력해 사용합니다.
        </p>
      </div>
    )

  /** 숨은 운영자 화면: 로그인 버튼을 오른쪽 클릭하면 열린다 */
  const openOperator = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    go('root')
  }

  /** 학교 아이디 옮기기. 과목·출판사는 그대로 따라가고, 교사들은 새 아이디를 다시 넣어야 한다 */
  const doRename = async () => {
    setRenameMsg(null)
    const err = schoolIdError(renameId)
    if (err) return setRenameMsg({ type: 'warn', text: err })
    const next = normalizeSchoolId(renameId)
    const cur = school?.schoolId || ''
    if (!window.confirm(`학교 아이디를 '${cur}' 에서 '${next}' 로 바꿉니다.\n\n과목·출판사는 그대로 옮겨지지만, 이미 '${cur}' 를 넣어 둔 선생님들은 새 아이디를 다시 입력해야 합니다. 계속할까요?`)) return
    const ok = await changeSchoolId(renameId)
    if (ok) {
      setRenameId('')
      setRenameMsg({ type: 'ok', text: `학교 아이디를 '${next}' 로 바꿨습니다. 선생님들께 새 아이디를 알려 주세요.` })
    }
  }

  const doSignUp = async () => {
    setMsg(null)
    if (!agree) return setMsg({ type: 'warn', text: '개인정보 처리방침에 동의해야 가입할 수 있습니다.' })
    const err = schoolIdError(newSchoolId)
    if (err) return setMsg({ type: 'warn', text: err })
    if (!newSchoolName.trim()) return setMsg({ type: 'warn', text: '학교 이름을 입력하세요.' })
    const ok = await signUp({ email, password, schoolId: newSchoolId, schoolName: newSchoolName })
    if (ok) {
      setPassword('')
      setMsg({ type: 'ok', text: '가입되었습니다. 과목·출판사 탭에서 목록을 등록한 뒤, 선생님들께 학교 아이디를 알려 주세요.' })
    }
  }

  return (
    <div className="grid2">
      <div className="card">
        <h2>학교 자료 연결</h2>
        {schoolStatus === 'ok' && school ? (
          <>
            <p>
              <b>{school.schoolName}</b> <span className="muted small">({school.schoolId})</span> 의 과목·출판사를 쓰고 있습니다.
            </p>
            <p className="muted small">과목 {school.subjects.length}개 · 출판사 {school.publishers.length}개</p>
            <div className="actions">
              <button className="btn" onClick={detachSchool}>
                연결 끊기
              </button>
            </div>

            {isOwner && (
              <>
                <h3 style={{ marginTop: 18 }}>학교 아이디 바꾸기</h3>
                <p className="muted small">
                  과목·출판사는 그대로 옮겨집니다. 다만 <b>이미 옛 아이디를 넣어 둔 선생님들은 새 아이디를 다시 입력해야 합니다.</b>
                </p>
                {renameMsg && <div className={`alert ${renameMsg.type}`}>{renameMsg.text}</div>}
                <div className="row">
                  <input
                    type="text"
                    value={renameId}
                    placeholder="새 학교 아이디 (예: haemil-2027-a7)"
                    onChange={(e) => setRenameId(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && doRename()}
                  />
                  <button className="btn" style={{ flex: '0 0 auto' }} disabled={busy || !renameId.trim()} onClick={doRename}>
                    {busy ? '바꾸는 중…' : '아이디 바꾸기'}
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <p className="muted small">담당 선생님께 받은 <b>학교 아이디</b>를 넣으면 그 학교의 과목·출판사가 채워집니다.</p>
            {schoolStatus === 'missing' && <div className="alert warn">‘{schoolId}’ 학교 아이디를 찾지 못했습니다. 아이디를 다시 확인해 주세요.</div>}
            {schoolStatus === 'error' && <div className="alert error">학교 자료를 불러오지 못했습니다. {schoolError}</div>}
            <div className="row">
              <input type="text" value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="예: haemil-high" onKeyDown={(e) => e.key === 'Enter' && attachSchool(joinId)} />
              <button className="btn primary" style={{ flex: '0 0 auto' }} disabled={busy} onClick={() => attachSchool(joinId)}>
                {busy ? '확인 중…' : '연결'}
              </button>
            </div>
          </>
        )}
        {authError && (
          <div className="alert error" style={{ marginTop: 12 }}>
            {authError}
            <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={clearAuthError}>
              닫기
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>담당 선생님 계정</h2>
        {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
        {user ? (
          <>
            <p>
              <b>{user.email}</b> 로 로그인했습니다. {isOwner ? <span className="badge info">이 학교 담당자</span> : <span className="badge gray">다른 학교 담당자</span>}
            </p>
            <div className="actions">
              <button className="btn" onClick={signOut} disabled={busy} onContextMenu={openOperator}>
                로그아웃
              </button>
              {isSuperAdmin && (
                <button className="btn" onClick={() => go('root')}>
                  운영자 화면
                </button>
              )}
            </div>

            <h3 style={{ marginTop: 18 }}>비밀번호 변경</h3>
            <div className="row">
              <input type="password" placeholder="현재 비밀번호" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
              <input type="password" placeholder="새 비밀번호 (6자 이상)" value={nextPw} onChange={(e) => setNextPw(e.target.value)} />
              <button
                className="btn"
                style={{ flex: '0 0 auto' }}
                disabled={busy || !curPw || nextPw.length < 6}
                onClick={async () => {
                  const ok = await changePassword(curPw, nextPw)
                  if (ok) {
                    setCurPw('')
                    setNextPw('')
                    setMsg({ type: 'ok', text: '비밀번호를 바꿨습니다.' })
                  }
                }}
              >
                변경
              </button>
            </div>

            <h3 style={{ marginTop: 18 }}>회원 탈퇴</h3>
            <p className="muted small">
              계정과 <b>이 학교의 과목·출판사 자료</b>가 함께 지워지며 되돌릴 수 없습니다. 선생님들이 쓰던 학교 아이디도 더는 쓸 수 없게 됩니다. 각 컴퓨터에 저장된 평가표·총괄표는 그대로 남습니다.
            </p>
            <div className="row">
              <input type="password" placeholder="확인을 위해 비밀번호 입력" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
              <button
                className="btn danger"
                style={{ flex: '0 0 auto' }}
                disabled={busy || !delPw}
                onClick={async () => {
                  if (!confirm('정말 탈퇴할까요? 계정과 학교 자료가 삭제되며 되돌릴 수 없습니다.')) return
                  const ok = await deleteAccount(delPw)
                  setDelPw('')
                  if (ok) setMsg({ type: 'ok', text: '탈퇴가 완료되었습니다. 계정과 학교 자료를 삭제했습니다.' })
                }}
              >
                탈퇴
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                className={`btn sm ${mode === 'signIn' ? 'primary' : ''}`}
                onClick={() => setMode('signIn')}
                onContextMenu={openOperator}
                title="운영자는 이 버튼을 오른쪽 클릭하세요"
              >
                로그인
              </button>
              <button className={`btn sm ${mode === 'signUp' ? 'primary' : ''}`} onClick={() => setMode('signUp')}>
                학교 등록(가입)
              </button>
            </div>
            <p className="muted small">
              학교마다 담당 선생님 계정 하나면 됩니다. 나머지 선생님은 가입 없이 <b>학교 아이디</b>만 넣어 쓰면 됩니다.
            </p>
            <label className="field">
              이메일
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teacher@school.kr" />
            </label>
            <label className="field" style={{ marginTop: 8 }}>
              비밀번호
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6자 이상" />
            </label>

            {mode === 'signUp' && (
              <>
                <label className="field" style={{ marginTop: 8 }}>
                  학교 이름
                  <input type="text" value={newSchoolName} onChange={(e) => setNewSchoolName(e.target.value)} placeholder="예: 해밀고등학교" />
                </label>
                <label className="field" style={{ marginTop: 8 }}>
                  학교 아이디 (선생님들께 알려 줄 코드)
                  <input type="text" value={newSchoolId} onChange={(e) => setNewSchoolId(e.target.value)} placeholder="예: haemil-high" />
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12 }}>
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span className="small">
                    <button className="linklike" onClick={() => go('privacy')}>
                      개인정보 처리방침
                    </button>
                    을 읽고 이메일 수집·이용에 동의합니다. (필수)
                  </span>
                </label>
              </>
            )}

            <div className="actions">
              {mode === 'signIn' ? (
                <>
                  <button
                    className="btn primary"
                    disabled={busy || !email || !password}
                    onClick={() => signIn(email, password)}
                    onContextMenu={openOperator}
                    title="운영자는 이 버튼을 오른쪽 클릭하세요"
                  >
                    {busy ? '처리 중…' : '로그인'}
                  </button>
                  <button
                    className="btn"
                    disabled={busy || !email}
                    onClick={async () => {
                      const ok = await sendReset(email)
                      if (ok) setMsg({ type: 'ok', text: '비밀번호 재설정 메일을 보냈습니다.' })
                    }}
                  >
                    비밀번호 재설정 메일
                  </button>
                </>
              ) : (
                <button className="btn primary" disabled={busy || !email || !password} onClick={doSignUp}>
                  {busy ? '처리 중…' : '학교 등록하기'}
                </button>
              )}
            </div>
            <p className="note">
              수집 항목은 담당 선생님 이메일과 학교 이름·아이디뿐입니다. 학생·교사의 평가 점수와 의견은 서버에 저장되지 않습니다.{' '}
              <button className="linklike" onClick={() => go('privacy')}>
                자세히
              </button>
            </p>
          </>
        )}
        {authError && (
          <div className="alert error" style={{ marginTop: 12 }}>
            {authError}
          </div>
        )}
      </div>
    </div>
  )
}
