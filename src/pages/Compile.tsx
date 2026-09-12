import { useMemo, useRef, useState } from 'react'
import type { Evaluation, Person, Summary, SummaryRecommend } from '../types'
import { uid } from '../seed'
import { fmtDate, useAppData } from '../store/useAppData'
import { columnTotal, computeSummary, criteriaFor, publishersFor } from '../lib/scoring'
import { aiGenerate } from '../lib/ai'
import { readFileText } from '../lib/csv'
import { printSheets } from '../lib/print'
import { SubjectSelect } from '../components/SubjectSelect'
import { Form1Sheet } from '../components/Form1Sheet'
import { Form2Sheet } from '../components/Form2Sheet'
import { Form3Sheet } from '../components/Form3Sheet'

const STEPS = ['과목·제출 현황', '서식2 총괄표', '서식3 추천의견서', '확정·인쇄']

export function Compile() {
  const { master, evaluations, summaries, saveSummary, saveMaster, saveEvaluation, mode, refresh } = useAppData()
  const [step, setStep] = useState(0)
  const [subjectId, setSubjectId] = useState('')
  const [sum, setSum] = useState<Summary | null>(null)
  const [writer, setWriter] = useState<Person>({ position: '교사', name: '' })
  const [checker, setChecker] = useState<Person>({ position: '교사', name: '' })
  const [msg, setMsg] = useState<{ type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [sortByAvg, setSortByAvg] = useState(false)
  const [viewEval, setViewEval] = useState<Evaluation | null>(null)
  const saveTimer = useRef<number | null>(null)

  const subject = master.subjects.find((s) => s.id === (sum?.subjectId || subjectId))
  const publishers = useMemo(() => (subject ? publishersFor(master, subject.id) : []), [master, subject])
  const criteria = useMemo(() => (subject ? criteriaFor(master, subject.id) : []), [master, subject])
  const subjEvals = useMemo(() => evaluations.filter((e) => e.subjectId === subject?.id), [evaluations, subject])
  const submitted = subjEvals.filter((e) => e.status === 'submitted')
  const committee = master.committee.filter((c) => c.subjectId === subject?.id)
  const existingSum = summaries.find((s) => s.subjectId === subject?.id)
  const finalized = sum?.status === 'finalized'

  // 현황판 행: 위원 명단 ∪ 제출/작성자
  const statusRows = useMemo(() => {
    const names = new Set<string>()
    committee.forEach((c) => names.add(c.teacherName))
    subjEvals.forEach((e) => names.add(e.teacherName))
    return Array.from(names).map((n) => {
      const e = subjEvals.find((x) => x.teacherName === n)
      return { name: n, ev: e, role: committee.find((c) => c.teacherName === n)?.role }
    })
  }, [committee, subjEvals])

  const latest = useRef<Summary | null>(null)
  latest.current = sum
  const update = (patch: Partial<Summary> | ((prev: Summary) => Partial<Summary>)) => {
    const prev = latest.current
    if (!prev) return
    const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
    latest.current = next
    setSum(next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveSummary(next).catch((e) => setMsg({ type: 'error', text: `저장 실패: ${e.message}` })), 800)
  }

  const buildMatrix = (evs: Evaluation[]) => {
    const matrix: Summary['matrix'] = {}
    for (const p of publishers) {
      matrix[p.id] = {}
      for (const e of evs) matrix[p.id][e.id] = columnTotal(e.scores[p.id], criteria)
    }
    return matrix
  }

  const generate = async () => {
    if (!subject) return setMsg({ type: 'warn', text: '과목을 선택하세요.' })
    if (submitted.length === 0) return setMsg({ type: 'warn', text: '제출된 평가표가 없습니다.' })
    const unsubmitted = statusRows.filter((r) => !r.ev || r.ev.status !== 'submitted')
    if (unsubmitted.length && !confirm(`미제출 위원 ${unsubmitted.length}명이 있습니다. 제출된 ${submitted.length}명 기준으로 그대로 생성할까요?`)) return
    if (existingSum && existingSum.status === 'draft' && !confirm('이미 작성 중인 총괄표가 있습니다. 제출 데이터로 다시 생성할까요? (취소하면 기존 총괄표를 불러옵니다)')) {
      setSum(existingSum)
      setStep(1)
      return
    }
    const members = submitted.map((e) => ({ teacherName: e.teacherName, evaluationId: e.id }))
    const matrix = buildMatrix(submitted)
    const comp = computeSummary(matrix, publishers.map((p) => p.id), submitted.map((e) => e.id), master.settings.averageDecimals)
    const ordered = [...publishers].sort((a, b) => comp.ranks[a.id] - comp.ranks[b.id])
    const recommendDoc: SummaryRecommend[] = [1, 2, 3].map((r) => ({ rank: r as 1 | 2 | 3, pubId: ordered[r - 1]?.id || null, text: existingSum?.recommendDoc.find((x) => x.rank === r)?.text || '' }))
    const next: Summary = {
      id: existingSum?.id || uid(),
      subjectId: subject.id,
      memberColumns: members,
      matrix,
      writer,
      checker,
      recommendDoc,
      recommendWriter: existingSum?.recommendWriter || { position: '교사', name: checker.name },
      recommendChecker: existingSum?.recommendChecker || { position: '교감', name: '' },
      status: 'draft',
      aiCount: existingSum?.aiCount || 0,
      updatedAt: new Date().toISOString(),
    }
    await saveSummary(next)
    setSum(next)
    setStep(1)
    setMsg({ type: 'info', text: `위원 ${members.length}명 기준으로 총괄표를 생성했습니다.` })
  }

  const loadExisting = () => {
    if (!existingSum) return
    setSum(existingSum)
    setWriter(existingSum.writer)
    setChecker(existingSum.checker)
    setStep(existingSum.status === 'finalized' ? 3 : 1)
  }

  const importFile = async (files: FileList | null) => {
    if (!files) return
    let n = 0
    for (const f of Array.from(files)) {
      try {
        const e = JSON.parse(await readFileText(f)) as Evaluation
        if (!e.id || !e.subjectId || !e.scores) throw new Error('형식 오류')
        await saveEvaluation({ ...e, status: 'submitted', submittedAt: e.submittedAt || new Date().toISOString() })
        n++
      } catch (err) {
        setMsg({ type: 'error', text: `${f.name} 가져오기 실패: ${(err as Error).message}` })
      }
    }
    if (n) setMsg({ type: 'ok', text: `${n}건의 제출 파일을 가져왔습니다.` })
  }

  const autoRank = () => {
    if (!sum) return
    const comp = computeSummary(sum.matrix, publishers.map((p) => p.id), sum.memberColumns.map((m) => m.evaluationId), master.settings.averageDecimals)
    const ordered = [...publishers].sort((a, b) => comp.ranks[a.id] - comp.ranks[b.id])
    update({ recommendDoc: sum.recommendDoc.map((r) => ({ ...r, pubId: ordered[r.rank - 1]?.id || null })) })
  }

  const generateRec = async (rank: number) => {
    if (!sum || !subject) return
    const item = sum.recommendDoc.find((r) => r.rank === rank)
    if (!item || !item.pubId) return
    const pub = publishers.find((p) => p.id === item.pubId)
    const memberEvals = sum.memberColumns.map((m) => evaluations.find((e) => e.id === m.evaluationId)).filter(Boolean) as Evaluation[]
    const sources = memberEvals
      .map((e) => {
        const r = e.recommend.find((x) => x.pubId === item.pubId)
        return r?.text || (e.ranks[0] === item.pubId ? e.summaryOpinion : '')
      })
      .filter(Boolean)
    const keyLabels = new Set<string>()
    memberEvals.forEach((e) => {
      const r = e.recommend.find((x) => x.pubId === item.pubId)
      r?.keys.forEach((k) => {
        const o = master.opinionOptions.find((x) => x.id === k)
        if (o && !o.negative) keyLabels.add(o.label)
      })
    })
    setBusy(true)
    const res = await aiGenerate(
      { kind: 'compile', subject: subject.name, publisher: pub?.name, rank, positives: [...keyLabels], negatives: [], tone: master.settings.tone, length: 'long', sources, avoid: sum.recommendDoc.filter((r) => r.rank !== rank && r.text).map((r) => r.text) },
      master.settings.aiModel,
      master.settings.aiFallbackModel,
    )
    setBusy(false)
    update((prev) => ({ recommendDoc: prev.recommendDoc.map((r) => (r.rank === rank ? { ...r, text: res.text } : r)), aiCount: prev.aiCount + (res.source === 'ai' ? 1 : 0) }))
    setMsg(res.source === 'ai' ? { type: 'ok', text: 'AI가 위원 의견을 종합했습니다.' } : { type: 'info', text: `규칙 기반으로 종합했습니다 (참고 의견 ${sources.length}건).` })
  }

  const finalize = async () => {
    if (!sum || !subject) return
    if (!confirm('총괄표와 추천의견서를 확정할까요? 확정 후 해당 과목은 마감되어 위원의 제출 취소·수정이 차단됩니다.')) return
    const next: Summary = { ...sum, status: 'finalized', finalizedAt: new Date().toISOString() }
    await saveSummary(next)
    setSum(next)
    await saveMaster({ ...master, subjects: master.subjects.map((s) => (s.id === subject.id ? { ...s, status: 'closed' } : s)) })
    setMsg({ type: 'ok', text: '확정되었습니다. 과목이 마감 처리되었습니다.' })
  }
  const unfinalize = async () => {
    if (!sum || !subject) return
    if (!confirm('확정을 취소하고 과목 마감을 해제할까요?')) return
    const next: Summary = { ...sum, status: 'draft', finalizedAt: undefined }
    await saveSummary(next)
    setSum(next)
    await saveMaster({ ...master, subjects: master.subjects.map((s) => (s.id === subject.id ? { ...s, status: 'open' } : s)) })
    setStep(1)
  }

  const members = sum?.memberColumns || []

  return (
    <div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <span key={s} className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`} onClick={() => sum && setStep(i)} style={{ cursor: sum ? 'pointer' : 'default' }}>
            {i + 1}. {s}
          </span>
        ))}
        <span className="spacer" />
        {sum && <span className={`badge ${finalized ? 'ok' : 'warn'}`}>{finalized ? `확정 ${fmtDate(sum.finalizedAt)}` : '작성 중'}</span>}
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      {step === 0 && (
        <div className="grid2">
          <div className="card">
            <h2>과목 선택</h2>
            <SubjectSelect subjects={master.subjects} value={subjectId} onChange={(id) => { setSubjectId(id); setSum(null) }} />
            {subject && (
              <>
                <div className="row" style={{ marginTop: 12 }}>
                  <label className="field">
                    작성자 직 (교과협의회 소속교사)
                    <input type="text" value={writer.position} onChange={(e) => setWriter({ ...writer, position: e.target.value })} />
                  </label>
                  <label className="field">
                    작성자 성명
                    <input type="text" value={writer.name} onChange={(e) => setWriter({ ...writer, name: e.target.value })} />
                  </label>
                </div>
                <div className="row">
                  <label className="field">
                    확인자 직 (대표교사)
                    <input type="text" value={checker.position} onChange={(e) => setChecker({ ...checker, position: e.target.value })} />
                  </label>
                  <label className="field">
                    확인자 성명
                    <input type="text" value={checker.name} onChange={(e) => setChecker({ ...checker, name: e.target.value })} />
                  </label>
                </div>
                <div className="actions">
                  <button className="btn primary lg" onClick={generate} disabled={submitted.length === 0 || subject.status === 'closed'}>
                    총괄표 생성
                  </button>
                  {existingSum && (
                    <button className="btn" onClick={loadExisting}>
                      기존 총괄표 불러오기 ({existingSum.status === 'finalized' ? '확정' : '작성 중'})
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="card">
            <h2>제출 현황 {subject && <span className="muted small">— {subject.name}</span>}</h2>
            {!subject && <p className="muted small">과목을 선택하세요.</p>}
            {subject && (
              <>
                <p>
                  <strong>{statusRows.length}</strong>명 중 <strong>{submitted.length}</strong>명 제출
                  {submitted.length > 0 && submitted.length < 3 && <span className="badge warn" style={{ marginLeft: 8 }}>위원 3인 미만 (소규모 학교 2인 가능)</span>}
                </p>
                <table className="data">
                  <thead>
                    <tr>
                      <th>위원명</th>
                      <th>제출일시</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusRows.map((r) => (
                      <tr key={r.name}>
                        <td>
                          {r.name} {r.role === 'lead' && <span className="badge info">대표</span>}
                        </td>
                        <td>{r.ev?.status === 'submitted' ? fmtDate(r.ev.submittedAt) : '-'}</td>
                        <td>{r.ev?.status === 'submitted' ? <span className="badge ok">제출</span> : r.ev ? <span className="badge warn">작성 중</span> : <span className="badge gray">미제출</span>}</td>
                      </tr>
                    ))}
                    {statusRows.length === 0 && (
                      <tr>
                        <td colSpan={3} className="muted">
                          제출 또는 작성 중인 위원이 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="actions">
                  {mode === 'supabase' && (
                    <button className="btn" onClick={refresh}>
                      새로고침
                    </button>
                  )}
                  <label className="btn">
                    제출 파일(JSON) 가져오기
                    <input type="file" accept="application/json,.json" multiple style={{ display: 'none' }} onChange={(e) => importFile(e.target.files)} />
                  </label>
                </div>
                <p className="note">위원이 [파일로 내보내기]한 JSON을 여기서 가져오면 제출로 처리됩니다. (온라인 공유 모드에서는 자동 반영)</p>
              </>
            )}
          </div>
        </div>
      )}

      {sum && subject && step === 1 && (
        <div>
          <div className="card">
            <h2>서식2 평가 총괄표 {finalized && <span className="badge gray">확정 — 읽기 전용</span>}</h2>
            <p className="muted small">셀을 클릭하여 점수를 수정하면 총점·평균·순위가 다시 계산됩니다. 위원 이름을 눌러 개인 제출본 원본을 확인할 수 있습니다.</p>
            <div className="actions" style={{ marginTop: 0 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={sortByAvg} onChange={(e) => setSortByAvg(e.target.checked)} /> 평균 내림차순 정렬
              </label>
              {members.map((m) => (
                <button key={m.evaluationId} className="btn sm" onClick={() => setViewEval(evaluations.find((e) => e.id === m.evaluationId) || null)}>
                  {m.teacherName} 원본
                </button>
              ))}
            </div>
            <div className="sheet-wrap">
              <Form2Sheet
                subjectName={subject.name}
                publishers={publishers}
                members={members}
                matrix={sum.matrix}
                headerMode={master.settings.memberHeaderMode}
                decimals={master.settings.averageDecimals}
                writer={sum.writer}
                checker={sum.checker}
                readOnly={finalized}
                sortByAverage={sortByAvg}
                onCellChange={(pid, eid, v) => update({ matrix: { ...sum.matrix, [pid]: { ...(sum.matrix[pid] || {}), [eid]: v } } })}
              />
            </div>
            <div className="row">
              <label className="field">
                작성자 직
                <input type="text" value={sum.writer.position} disabled={finalized} onChange={(e) => update({ writer: { ...sum.writer, position: e.target.value } })} />
              </label>
              <label className="field">
                작성자 성명
                <input type="text" value={sum.writer.name} disabled={finalized} onChange={(e) => update({ writer: { ...sum.writer, name: e.target.value } })} />
              </label>
              <label className="field">
                확인자 직
                <input type="text" value={sum.checker.position} disabled={finalized} onChange={(e) => update({ checker: { ...sum.checker, position: e.target.value } })} />
              </label>
              <label className="field">
                확인자 성명
                <input type="text" value={sum.checker.name} disabled={finalized} onChange={(e) => update({ checker: { ...sum.checker, name: e.target.value } })} />
              </label>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => setStep(0)}>
                이전
              </button>
              <button className="btn primary" onClick={() => setStep(2)}>
                다음: 추천의견서
              </button>
            </div>
          </div>
          {viewEval && (
            <div className="card">
              <div className="actions" style={{ marginTop: 0 }}>
                <h3 style={{ margin: 0 }}>{viewEval.teacherName} 위원 제출 원본</h3>
                <span className="spacer" />
                <button className="btn sm" onClick={() => setViewEval(null)}>
                  닫기
                </button>
              </div>
              <div className="sheet-wrap">
                <Form1Sheet subjectName={subject.name} teacherName={viewEval.teacherName} criteria={criteria} publishers={publishers} scores={viewEval.scores} opinion={viewEval.summaryOpinion} readOnly />
              </div>
            </div>
          )}
        </div>
      )}

      {sum && subject && step === 2 && (
        <div>
          <div className="card">
            <h2>서식3 추천 의견서 (공식) {finalized && <span className="badge gray">확정 — 읽기 전용</span>}</h2>
            <p className="muted small">순위는 총괄표 평균 순위로 자동 산출되며 출판사 칸에서 변경할 수 있습니다. [의견 생성]은 위원들의 개인 추천의견을 종합합니다.</p>
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn" onClick={autoRank} disabled={finalized}>
                순위 자동 산출
              </button>
              {sum.recommendDoc.map((r) => (
                <button key={r.rank} className="btn primary" onClick={() => generateRec(r.rank)} disabled={busy || finalized || !r.pubId}>
                  {busy ? '생성 중…' : `${r.rank}순위 의견 생성`}
                </button>
              ))}
            </div>
            <div className="sheet-wrap">
              <Form3Sheet
                variant="official"
                subjectName={subject.name}
                publishers={publishers}
                rows={sum.recommendDoc}
                writer={sum.recommendWriter}
                checker={sum.recommendChecker}
                readOnly={finalized}
                onTextChange={(rank, v) => update({ recommendDoc: sum.recommendDoc.map((r) => (r.rank === rank ? { ...r, text: v } : r)) })}
                onPubChange={(rank, pid) => update({ recommendDoc: sum.recommendDoc.map((r) => (r.rank === rank ? { ...r, pubId: pid || null } : r)) })}
              />
            </div>
            <div className="row">
              <label className="field">
                작성자 직 (대표교사)
                <input type="text" value={sum.recommendWriter.position} disabled={finalized} onChange={(e) => update({ recommendWriter: { ...sum.recommendWriter, position: e.target.value } })} />
              </label>
              <label className="field">
                작성자 성명
                <input type="text" value={sum.recommendWriter.name} disabled={finalized} onChange={(e) => update({ recommendWriter: { ...sum.recommendWriter, name: e.target.value } })} />
              </label>
              <label className="field">
                확인자 직 (교감)
                <input type="text" value={sum.recommendChecker.position} disabled={finalized} onChange={(e) => update({ recommendChecker: { ...sum.recommendChecker, position: e.target.value } })} />
              </label>
              <label className="field">
                확인자 성명
                <input type="text" value={sum.recommendChecker.name} disabled={finalized} onChange={(e) => update({ recommendChecker: { ...sum.recommendChecker, name: e.target.value } })} />
              </label>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => setStep(1)}>
                이전
              </button>
              <button className="btn primary" onClick={() => setStep(3)}>
                다음: 확정·인쇄
              </button>
            </div>
          </div>
        </div>
      )}

      {sum && subject && step === 3 && (
        <div>
          <div className="preview-toolbar card">
            <button className="btn primary" onClick={() => printSheets()}>
              서식2 + 서식3 인쇄 / PDF
            </button>
            <span className="spacer" />
            {!finalized ? (
              <>
                <button className="btn" onClick={() => setStep(2)}>
                  이전
                </button>
                <button className="btn primary lg" onClick={finalize}>
                  제출(확정) 및 과목 마감
                </button>
              </>
            ) : (
              <button className="btn" onClick={unfinalize}>
                확정 취소(마감 해제)
              </button>
            )}
          </div>
          <div className="sheet-wrap">
            <Form2Sheet subjectName={subject.name} publishers={publishers} members={members} matrix={sum.matrix} headerMode={master.settings.memberHeaderMode} decimals={master.settings.averageDecimals} writer={sum.writer} checker={sum.checker} readOnly sortByAverage={sortByAvg} />
            <Form3Sheet variant="official" subjectName={subject.name} publishers={publishers} rows={sum.recommendDoc} writer={sum.recommendWriter} checker={sum.recommendChecker} readOnly />
          </div>
        </div>
      )}
    </div>
  )
}
