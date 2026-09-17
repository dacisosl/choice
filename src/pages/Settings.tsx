import { useState } from 'react'
import type { Criterion, Master, Publisher, Subject } from '../types'
import { DEFAULT_CRITERIA, seedSubjects, uid } from '../seed'
import { useAppData } from '../store/useAppData'
import { publishersFor } from '../lib/scoring'
import { downloadText, parseCsv, readFileText, toCsv } from '../lib/csv'
import { josa } from '../lib/josa'

const TABS = ['교과서 자료', '선정 과목 관리', '과목별 출판사 관리', '평가기준']
type Msg = { type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null

export function Settings(_: { go: (h: string) => void }) {
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
      {tab === 0 && <CatalogTab />}
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

/** 목록은 이 컴퓨터에서 누구나 고칠 수 있다 */
function useSharedEditable() {
  return { canEdit: true }
}

/** 교과서 자료에서 받아 온 항목이 섞여 있을 때의 안내 */
function SharedNotice() {
  const { master, catalog } = useAppData()
  const fromCatalog = master.subjects.filter((s) => s.source === 'catalog').length
  if (!catalog || !fromCatalog) return null
  return (
    <div className="alert info">
      이 중 <b>{fromCatalog}개 과목</b>은 앱에 실려 온 교과서 자료에서 받아 왔습니다. 여기서 고치거나 지울 수 있지만, 자료가 갱신되면 그 항목은 새 자료로 다시 채워집니다.
    </div>
  )
}

/** 앱과 함께 배포된 교과서 자료 안내 */
function CatalogTab() {
  const { master, catalog, reloadCatalog } = useAppData()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const subjects = master.subjects.filter((s) => s.source === 'catalog')
  const pubs = master.publishers.filter((p) => p.source === 'catalog')
  const own = master.subjects.length - subjects.length

  const reload = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await reloadCatalog()
      setMsg({ type: 'ok', text: '교과서 자료를 다시 불러왔습니다.' })
    } catch (e) {
      setMsg({ type: 'error', text: `불러오지 못했습니다: ${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>교과서 자료</h2>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      {catalog && subjects.length > 0 ? (
        <>
          <p>
            과목 <b>{subjects.length}개</b> · 출판사 <b>{pubs.length}개</b>
            {catalog.updatedAt ? <span className="muted small"> · 자료 갱신일 {catalog.updatedAt}</span> : null}
          </p>
          <p className="muted small">
            과목을 고르면 그 과목의 출판사가 자동으로 채워집니다. 목록에 없는 과목·출판사는 작성 화면이나 아래 탭에서 직접 넣을 수 있습니다.
            {own > 0 ? ` (직접 넣은 과목 ${own}개)` : ''}
          </p>
        </>
      ) : (
        <p className="muted small">
          아직 교과서 자료가 없습니다(<code>public/catalog.json</code>). 자료가 없어도 작성 화면에서 <b>과목명과 출판사를 직접 넣어</b> 바로 쓸 수 있습니다.
        </p>
      )}
      <div className="actions">
        <button className="btn" onClick={reload} disabled={busy}>
          {busy ? '불러오는 중…' : '자료 다시 불러오기'}
        </button>
      </div>
      <p className="note">
        자료는 앱과 함께 배포되는 <code>public/catalog.json</code> 파일입니다. 서버도 로그인도 쓰지 않으며, 작성한 평가표·총괄표는 이 컴퓨터에만 저장됩니다.
      </p>
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

        <div className="scroll-x list-scroll" style={{ marginTop: 12 }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 90 }}>학교</th>
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
                      <select value={s.school || ''} onChange={(e) => patch(s.id, { school: (e.target.value || undefined) as Subject['school'] })}>
                        <option value="">-</option>
                        <option value="중">중학교</option>
                        <option value="고">고등학교</option>
                      </select>
                    ) : s.school ? (
                      `${s.school}학교`
                    ) : (
                      '-'
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
    setPubs(subject.id, [...pubs, { id: uid(), subjectId: subject.id, name: newPub.trim(), order: pubs.length + 1 }], `${newPub.trim()}${josa(newPub.trim(), '을')} 추가했습니다.`)
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
        <p className="muted small">평가기준은 이 컴퓨터에만 저장됩니다. 고치면 작성 중인 평가표와 저장된 평가표를 다시 열 때 새 기준이 바로 적용됩니다.</p>
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