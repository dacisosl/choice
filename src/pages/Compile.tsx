import { useMemo, useRef, useState } from 'react'
import type { DocPublisher, Person, Summary, SummaryMember, SummaryRecommend } from '../types'
import { uid } from '../seed'
import { fmtDate, useAppData } from '../store/useAppData'
import { columnTotal, computeSummary, criteriaFor } from '../lib/scoring'
import { downloadText, readFileText } from '../lib/csv'
import { printSheets } from '../lib/print'
import { importMemberFiles, squeezeName, type ImportProgress } from '../lib/pdfImport'
import { SubjectSelect } from '../components/SubjectSelect'
import { Form1Sheet } from '../components/Form1Sheet'
import { Form2Sheet } from '../components/Form2Sheet'
import { Form3Sheet } from '../components/Form3Sheet'
import { OpinionModal } from '../components/OpinionModal'
import { HeaderSlot } from '../components/HeaderSlot'
import { SchoolConnect } from '../components/SchoolConnect'
import { SheetFit } from '../components/SheetFit'
import { NoticeModal } from '../components/NoticeModal'

const STEPS = ['점수표 올리기', '총괄표 확인', '인쇄·저장']
type Msg = { type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null
/** 안내 창: 점수 수정 제한 / 인쇄 전 확인 */
type Notice = { title: string; tone: 'warn' | 'info'; lines: string[]; confirmLabel?: string; onConfirm?: () => void } | null

const AI_NOTE = '올린 평가표에서 계산한 초안입니다. 원본과 대조해 확인해 주세요.'

/** 위원 문서에서 이 출판사의 총점을 꺼낸다 (이름으로 맞춘다) */
function totalOf(member: SummaryMember, pubName: string): number | null {
  const ev = member.evaluation
  if (!ev) return null
  const pub = ev.publishers.find((p) => squeezeName(p.name) === squeezeName(pubName))
  if (!pub) return null
  return columnTotal(ev.scores[pub.id], ev.criteria)
}

export function Compile({ go }: { go: (h: string) => void }) {
  const { master, summaries, saveSummary, deleteSummary, schoolStatus } = useAppData()
  const [step, setStep] = useState(0)
  const [writerName, setWriterName] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [subjectName, setSubjectName] = useState('')
  const [members, setMembers] = useState<SummaryMember[]>([])
  const [sum, setSum] = useState<Summary | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [sortByAvg, setSortByAvg] = useState(false)
  const [viewMember, setViewMember] = useState<SummaryMember | null>(null)
  const [modalRank, setModalRank] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const saveTimer = useRef<number | null>(null)

  const subject = master.subjects.find((s) => s.id === subjectId)
  const subjectGroup = subject?.subjectGroup || ''

  const latest = useRef<Summary | null>(null)
  const update = (patch: Partial<Summary> | ((prev: Summary) => Partial<Summary>)) => {
    const prev = latest.current
    if (!prev) return
    const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
    latest.current = next
    setSum(next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveSummary(next).catch((e) => setMsg({ type: 'error', text: `저장 실패: ${e.message}` })), 800)
  }

  /** 위원 한 명이 줄 수 있는 최고 점수 (평가기준 배점의 합, 기본 100) */
  const maxTotal = useMemo(() => {
    const list = criteriaFor(master, sum?.subjectId || subjectId)
    const total = list.reduce((a, c) => a + c.points, 0)
    return total > 0 ? total : 100
  }, [master, sum?.subjectId, subjectId])

  /** 총괄표 점수 수정: 한 위원이 줄 수 있는 범위를 벗어나면 넣지 않는다 */
  const changeCell = (pubId: string, memberId: string, v: number) => {
    if (!sum) return
    const put = (n: number) => update({ matrix: { ...sum.matrix, [pubId]: { ...(sum.matrix[pubId] || {}), [memberId]: n } } })
    if (v >= 0 && v <= maxTotal) return put(v)
    const fixed = Math.max(0, Math.min(maxTotal, v))
    setNotice({
      title: '이 점수는 넣을 수 없습니다',
      tone: 'warn',
      lines: [
        `위원 한 명이 줄 수 있는 점수는 0~${maxTotal}점입니다.`,
        '평가표 원본의 합계를 다시 확인해 주세요.',
      ],
      confirmLabel: `${fixed}점으로 넣기`,
      onConfirm: () => {
        put(fixed)
        setNotice(null)
      },
    })
  }

  /** 인쇄 전에 책임·검토를 한 번 짚어 준다 */
  const askPrint = () => {
    if (!sum) return
    setNotice({
      title: '인쇄하기 전에 확인해 주세요',
      tone: 'info',
      lines: [
        '이 서류의 최종 책임은 작성자 본인에게 있습니다.',
        '위원들이 올린 평가표에서 자동으로 계산한 초안입니다. 총점 · 평균 · 순위를 원본과 대조한 뒤 제출해 주세요.',
        '위원 이름과 출판사명이 바르게 들어갔는지 다시 한 번 살펴 주세요.',
      ],
      confirmLabel: '확인했습니다, 인쇄',
      onConfirm: () => {
        setNotice(null)
        printSheets(undefined, `총괄서류_${sum.subjectName}`)
      },
    })
  }

  // ───────────── 파일 올리기 ─────────────
  const addFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return
    setMsg(null)
    const { members: got, errors } = await importMemberFiles(list, setProgress)
    setProgress(null)
    if (got.length) {
      setMembers((prev) => [...prev, ...got])
      const name = got.find((m) => m.evaluation?.subjectName)?.evaluation?.subjectName || ''
      if (name && !subjectId) {
        const hit = master.subjects.find((s) => s.name === name)
        if (hit) setSubjectId(hit.id)
        setSubjectName(name)
      }
    }
    const parts: string[] = []
    if (got.length) parts.push(`${got.length}명의 평가표를 읽었습니다.`)
    if (errors.length) parts.push(`읽지 못한 파일 ${errors.length}개: ${errors.map((e) => `${e.file} (${e.reason})`).join(' / ')}`)
    setMsg({ type: errors.length ? (got.length ? 'warn' : 'error') : 'ok', text: parts.join(' ') })
  }

  const addManual = () => {
    const name = prompt('직접 추가할 위원 이름을 입력하세요.')
    if (!name?.trim()) return
    setMembers((prev) => [...prev, { id: uid(), teacherName: name.trim(), source: 'manual', warnings: ['점수를 직접 입력해야 합니다.'] }])
  }

  const removeMember = (id: string) => setMembers((prev) => prev.filter((m) => m.id !== id))

  /** 올린 위원들의 출판사 합집합 (이름 기준, 먼저 올라온 순서) */
  const mergedPublishers = useMemo<DocPublisher[]>(() => {
    const out: DocPublisher[] = []
    for (const m of members) {
      for (const p of m.evaluation?.publishers || []) {
        if (!out.some((x) => squeezeName(x.name) === squeezeName(p.name))) out.push({ id: uid(), name: p.name })
      }
    }
    return out
  }, [members])

  const existing = summaries.find((s) => (subjectId ? s.subjectId === subjectId : s.subjectName === subjectName))

  const generate = async () => {
    const name = subject?.name || subjectName.trim()
    if (!name) return setMsg({ type: 'warn', text: '과목을 선택하거나 과목명을 입력하세요.' })
    if (!members.length) return setMsg({ type: 'warn', text: '위원 점수표(PDF 또는 JSON)를 먼저 올리세요.' })
    if (!mergedPublishers.length) return setMsg({ type: 'warn', text: '출판사를 읽지 못했습니다. 위원이 [인쇄 / PDF 저장]으로 만든 파일인지 확인해 주세요.' })
    if (members.length < 3 && !confirm(`위원이 ${members.length}명입니다. 계획서는 3인 이상을 권장합니다(소규모 학교 2인 가능). 그대로 만들까요?`)) return
    if (existing && !confirm('이 과목의 총괄표가 이미 있습니다. 올린 점수표로 다시 만들까요? (취소하면 기존 총괄표를 엽니다)')) {
      return loadExisting(existing)
    }

    const warned: SummaryMember[] = members.map((m) => ({ ...m, warnings: [...m.warnings] }))
    const matrix: Summary['matrix'] = {}
    for (const pub of mergedPublishers) {
      matrix[pub.id] = {}
      warned.forEach((m) => {
        const t = totalOf(m, pub.name)
        matrix[pub.id][m.id] = t ?? 0
        if (t === null && m.source !== 'manual') m.warnings.push(`'${pub.name}' 점수가 없어 0으로 두었습니다. 표에서 직접 고칠 수 있습니다.`)
      })
    }

    const comp = computeSummary(matrix, mergedPublishers.map((p) => p.id), warned.map((m) => m.id), master.settings.averageDecimals)
    const ordered = [...mergedPublishers].sort((a, b) => comp.ranks[a.id] - comp.ranks[b.id])
    const recommendDoc: SummaryRecommend[] = [1, 2, 3].map((r) => ({
      rank: r as 1 | 2 | 3,
      pubId: ordered[r - 1]?.id || null,
      text: existing?.recommendDoc.find((x) => x.rank === r)?.text || '',
    }))

    const writer: Person = { position: '교사', name: writerName.trim() }
    const next: Summary = {
      id: existing?.id || uid(),
      subjectId: subject?.id || '',
      subjectName: name,
      publishers: mergedPublishers,
      members: warned,
      matrix,
      writer,
      checker: existing?.checker || { position: '교사', name: '' },
      recommendDoc,
      recommendWriter: existing?.recommendWriter || writer,
      recommendChecker: existing?.recommendChecker || { position: '교감', name: '' },
      aiCount: existing?.aiCount || 0,
      updatedAt: new Date().toISOString(),
    }
    await saveSummary(next)
    latest.current = next
    setSum(next)
    setMembers(warned)
    setStep(1)
    setMsg({ type: 'info', text: `위원 ${warned.length}명·출판사 ${mergedPublishers.length}곳으로 총괄표를 만들었습니다. 숫자를 확인하고 필요하면 표에서 고치세요.` })
  }

  const loadExisting = (s: Summary) => {
    latest.current = s
    setSum(s)
    setMembers(s.members)
    setSubjectId(s.subjectId)
    setSubjectName(s.subjectName)
    setWriterName(s.writer.name)
    setStep(1)
    setMsg(null)
  }

  const importSummaryJson = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    try {
      const raw = JSON.parse(await readFileText(f)) as Summary
      if (!raw.members || !raw.publishers || !raw.matrix) throw new Error('총괄표 파일이 아닙니다.')
      const next = { ...raw, id: raw.id || uid() }
      await saveSummary(next)
      loadExisting(next)
      setMsg({ type: 'ok', text: `${next.subjectName} 총괄표를 불러왔습니다.` })
    } catch (e) {
      setMsg({ type: 'error', text: `불러오기 실패: ${(e as Error).message}` })
    }
  }

  const autoRank = () => {
    if (!sum) return
    const comp = computeSummary(sum.matrix, sum.publishers.map((p) => p.id), sum.members.map((m) => m.id), master.settings.averageDecimals)
    const ordered = [...sum.publishers].sort((a, b) => comp.ranks[a.id] - comp.ranks[b.id])
    update({ recommendDoc: sum.recommendDoc.map((r) => ({ ...r, pubId: ordered[r.rank - 1]?.id || null })) })
  }

  const removeSaved = async (s: Summary) => {
    if (!confirm(`${s.subjectName} 총괄표를 삭제할까요? 되돌릴 수 없습니다.`)) return
    await deleteSummary(s.id)
    if (sum?.id === s.id) {
      latest.current = null
      setSum(null)
      setStep(0)
    }
  }

  const exportJson = () => {
    if (!sum) return
    downloadText(`총괄표_${sum.subjectName}.json`, JSON.stringify(sum, null, 2), 'application/json')
  }

  // ───────────── 서식3 의견 창 ─────────────
  const renderModal = () => {
    if (modalRank === null || !sum) return null
    const item = sum.recommendDoc.find((r) => r.rank === modalRank)
    if (!item) return null
    const pub = sum.publishers.find((p) => p.id === item.pubId)
    const sources = pub
      ? (sum.members
          .map((m) => {
            const ev = m.evaluation
            if (!ev) return null
            const mine = ev.publishers.find((p) => squeezeName(p.name) === squeezeName(pub.name))
            if (!mine) return null
            const rec = ev.recommend.find((r) => r.pubId === mine.id)
            const text = rec?.text || (ev.ranks[0] === mine.id ? ev.summaryOpinion : '')
            return text ? { teacherName: m.teacherName, text } : null
          })
          .filter(Boolean) as { teacherName: string; text: string }[])
      : []
    return (
      <OpinionModal
        title={`${item.rank}순위 추천의견 — ${pub?.name || '출판사 미선택'}`}
        scope="recommend"
        kind="compile"
        subjectName={sum.subjectName}
        subjectGroup={subjectGroup}
        publisherName={pub?.name}
        rank={item.rank}
        options={master.opinionOptions}
        settings={master.settings}
        initialKeys={[]}
        initialText={item.text}
        aiCount={sum.aiCount}
        sources={sources}
        avoid={sum.recommendDoc.filter((r) => r.rank !== item.rank && r.text).map((r) => r.text)}
        notice={pub ? undefined : '이 순위의 출판사를 먼저 표에서 고르면 문장을 생성할 수 있습니다.'}
        onCancel={() => setModalRank(null)}
        onApply={({ text, aiUsed }) => {
          update((prev) => ({
            recommendDoc: prev.recommendDoc.map((r) => (r.rank === item.rank ? { ...r, text } : r)),
            aiCount: prev.aiCount + aiUsed,
          }))
          setModalRank(null)
        }}
      />
    )
  }

  const memberCols = (sum?.members || members).map((m) => ({ id: m.id, teacherName: m.teacherName }))

  return (
    <div>
      <HeaderSlot>
        <div className="steps">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`}
              onClick={() => sum && setStep(i)}
              style={{ cursor: sum ? 'pointer' : 'default' }}
              title={sum ? `저장됨 ${fmtDate(sum.updatedAt)}` : undefined}
            >
              {i + 1}. {s}
            </span>
          ))}
        </div>
      </HeaderSlot>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      {progress && (
        <div className="alert info">
          {progress.file} — {progress.note}
          {progress.ratio !== undefined && ` (${Math.round(progress.ratio * 100)}%)`}
        </div>
      )}

      <div className="work-layout">
        {/* 왼쪽: 입력 사이드바 */}
        <aside className="work-side no-print">
          <SchoolConnect />
          <div className="card side-card">
            <h3>기본정보</h3>
            <label className="field">
              작성자 이름
              <input type="text" value={writerName} onChange={(e) => setWriterName(e.target.value)} placeholder="홍길동" />
            </label>
            <label className="field">
              과목
              {master.subjects.length > 0 ? (
                <SubjectSelect subjects={master.subjects} value={subjectId} onChange={(id) => { setSubjectId(id); setSubjectName(master.subjects.find((s) => s.id === id)?.name || '') }} />
              ) : (
                <input type="text" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="예: 세계사" />
              )}
            </label>
            {master.subjects.length > 0 && !subjectId && (
              <label className="field">
                목록에 없으면 직접 입력
                <input type="text" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="예: 세계사" />
              </label>
            )}

            <h3 style={{ marginTop: 16 }}>위원 평가표 ({members.length})</h3>
            <div
              className={`dropzone sm ${dragOver ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                addFiles(e.dataTransfer.files)
              }}
            >
              <p>평가표 PDF를 끌어다 놓거나</p>
              <label className="btn primary sm">
                + 추가하기
                <input type="file" accept="application/pdf,.pdf,application/json,.json" multiple style={{ display: 'none' }} onChange={(e) => addFiles(e.target.files)} />
              </label>
            </div>

            {members.length > 0 && (
              <div className="side-members">
                {members.map((m) => (
                  <div className="side-doc" key={m.id}>
                    <div>
                      <b>{m.teacherName}</b>{' '}
                      {m.source === 'pdf' && <span className="badge ok">PDF</span>}
                      {m.source === 'pdf-ocr' && <span className="badge warn">스캔</span>}
                      {m.source === 'json' && <span className="badge info">파일</span>}
                      {m.source === 'manual' && <span className="badge gray">직접</span>}
                      {m.warnings.length > 0 && <div className="muted small">확인 필요</div>}
                    </div>
                    <button className="icon-x" onClick={() => removeMember(m.id)} aria-label="삭제" title="삭제">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {step === 0 && (
              <div className="side-actions">
                <button className="btn primary" onClick={generate} disabled={!members.length}>
                  총괄표 생성하기
                </button>
                <button className="btn sm" onClick={addManual}>
                  위원 직접 추가
                </button>
                <label className="btn sm">
                  총괄표 파일(JSON) 불러오기
                  <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => importSummaryJson(e.target.files)} />
                </label>
              </div>
            )}
          </div>

          {step === 0 && summaries.length > 0 && (
            <div className="card side-card">
              <h3>이 컴퓨터의 총괄표</h3>
              {summaries.map((s) => (
                <div className="side-doc" key={s.id}>
                  <div>
                    <b>{s.subjectName}</b>
                    <div className="muted small">위원 {s.members.length}명 · {fmtDate(s.updatedAt)}</div>
                  </div>
                  <div>
                    <button className="btn sm" onClick={() => loadExisting(s)}>
                      열기
                    </button>{' '}
                    <button className="btn sm danger" onClick={() => removeSaved(s)}>
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* 오른쪽: 서식 */}
        <div className="work-main">
          {step === 0 && (
            <div className="card">
              <h2>올린 평가표</h2>
              {members.length === 0 ? (
                <p className="muted small">왼쪽에서 위원들이 보낸 평가표 PDF를 올리세요. 파일에서 위원명·출판사·점수를 읽어 옵니다.</p>
              ) : (
                <div className="scroll-x">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>위원</th>
                        <th style={{ width: 70 }}>출처</th>
                        <th style={{ width: 70 }}>출판사</th>
                        <th>확인할 점</th>
                        <th style={{ width: 60 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.id}>
                          <td>{m.teacherName}</td>
                          <td>
                            {m.source === 'pdf' && <span className="badge ok">PDF</span>}
                            {m.source === 'pdf-ocr' && <span className="badge warn">스캔</span>}
                            {m.source === 'json' && <span className="badge info">파일</span>}
                            {m.source === 'manual' && <span className="badge gray">직접</span>}
                          </td>
                          <td>{m.evaluation?.publishers.length ?? '-'}</td>
                          <td className="small muted">{m.warnings.length ? m.warnings.join(' ') : '-'}</td>
                          <td>
                            <button className="btn sm danger" onClick={() => removeMember(m.id)}>
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {sum && step === 1 && (
            <>
              <div className="card">
                <div className="main-head">
                  <h2>평가 총괄표</h2>
                  <span className="ai-note">{AI_NOTE}</span>
                  <div className="main-head-actions">
                    <button className="btn" onClick={() => setStep(0)}>
                      이전
                    </button>
                    <button className="btn primary" onClick={() => setStep(2)}>
                      다음: 인쇄·저장
                    </button>
                  </div>
                </div>
                <p className="muted small">셀을 클릭하면 점수를 고칠 수 있고 총점·평균·순위가 다시 계산됩니다.</p>
                <div className="actions" style={{ marginTop: 0 }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={sortByAvg} onChange={(e) => setSortByAvg(e.target.checked)} /> 평균 내림차순 정렬
                  </label>
                  {sum.members
                    .filter((m) => m.evaluation)
                    .map((m) => (
                      <button key={m.id} className="btn sm" onClick={() => setViewMember(viewMember?.id === m.id ? null : m)}>
                        {m.teacherName} 원본
                      </button>
                    ))}
                </div>
                <SheetFit bottomGap={120}>
                  <Form2Sheet
                    subjectName={sum.subjectName}
                    publishers={sum.publishers}
                    members={memberCols}
                    matrix={sum.matrix}
                    headerMode={master.settings.memberHeaderMode}
                    decimals={master.settings.averageDecimals}
                    writer={sum.writer}
                    checker={sum.checker}
                    sortByAverage={sortByAvg}
                    onCellChange={changeCell}
                  />
                </SheetFit>
                <div className="row">
                  <label className="field">
                    작성자 직
                    <input type="text" value={sum.writer.position} onChange={(e) => update({ writer: { ...sum.writer, position: e.target.value } })} />
                  </label>
                  <label className="field">
                    작성자 성명
                    <input type="text" value={sum.writer.name} onChange={(e) => update({ writer: { ...sum.writer, name: e.target.value } })} />
                  </label>
                  <label className="field">
                    확인자 직
                    <input type="text" value={sum.checker.position} onChange={(e) => update({ checker: { ...sum.checker, position: e.target.value } })} />
                  </label>
                  <label className="field">
                    확인자 성명
                    <input type="text" value={sum.checker.name} onChange={(e) => update({ checker: { ...sum.checker, name: e.target.value } })} />
                  </label>
                </div>
              </div>

              {viewMember?.evaluation && (
                <div className="card">
                  <div className="actions" style={{ marginTop: 0 }}>
                    <h3 style={{ margin: 0 }}>{viewMember.teacherName} 위원 평가표 원본</h3>
                    <span className="spacer" />
                    <button className="btn sm" onClick={() => setViewMember(null)}>
                      닫기
                    </button>
                  </div>
                  <SheetFit bottomGap={120}>
                    <Form1Sheet
                      subjectName={viewMember.evaluation.subjectName}
                      teacherName={viewMember.evaluation.teacherName}
                      criteria={viewMember.evaluation.criteria}
                      publishers={viewMember.evaluation.publishers}
                      scores={viewMember.evaluation.scores}
                      opinion={viewMember.evaluation.summaryOpinion}
                      readOnly
                    />
                  </SheetFit>
                </div>
              )}

              <div className="card">
                <h2>추천 의견서</h2>
                <p className="muted small">순위는 평균으로 자동 산출되며 출판사 칸에서 바꿀 수 있습니다. 의견 칸을 클릭하면 위원 의견을 종합하는 창이 열립니다.</p>
                <div className="actions" style={{ marginTop: 0 }}>
                  <button className="btn" onClick={autoRank}>
                    순위 자동 산출
                  </button>
                </div>
                <SheetFit bottomGap={120}>
                  <Form3Sheet
                    variant="official"
                    subjectName={sum.subjectName}
                    publishers={sum.publishers}
                    rows={sum.recommendDoc}
                    writer={sum.recommendWriter}
                    checker={sum.recommendChecker}
                    onTextChange={(rank, v) => update({ recommendDoc: sum.recommendDoc.map((r) => (r.rank === rank ? { ...r, text: v } : r)) })}
                    onPubChange={(rank, pid) => update({ recommendDoc: sum.recommendDoc.map((r) => (r.rank === rank ? { ...r, pubId: pid || null } : r)) })}
                    onOpinionClick={(rank) => setModalRank(rank)}
                  />
                </SheetFit>
                <div className="row">
                  <label className="field">
                    작성자 직 (대표교사)
                    <input type="text" value={sum.recommendWriter.position} onChange={(e) => update({ recommendWriter: { ...sum.recommendWriter, position: e.target.value } })} />
                  </label>
                  <label className="field">
                    작성자 성명
                    <input type="text" value={sum.recommendWriter.name} onChange={(e) => update({ recommendWriter: { ...sum.recommendWriter, name: e.target.value } })} />
                  </label>
                  <label className="field">
                    확인자 직 (교감)
                    <input type="text" value={sum.recommendChecker.position} onChange={(e) => update({ recommendChecker: { ...sum.recommendChecker, position: e.target.value } })} />
                  </label>
                  <label className="field">
                    확인자 성명
                    <input type="text" value={sum.recommendChecker.name} onChange={(e) => update({ recommendChecker: { ...sum.recommendChecker, name: e.target.value } })} />
                  </label>
                </div>
              </div>
            </>
          )}

          {sum && step === 2 && (
            <div className="card">
              <div className="main-head">
                <h2>인쇄·저장</h2>
                <span className="ai-note">{AI_NOTE}</span>
                <div className="main-head-actions">
                  <button className="btn" onClick={() => setStep(1)}>
                    이전
                  </button>
                  <button className="btn primary" onClick={askPrint}>
                    인쇄 / PDF 저장
                  </button>
                  <button className="btn" onClick={exportJson}>
                    JSON 내보내기
                  </button>
                </div>
              </div>
              <p className="muted small">여기서도 점수 칸과 의견 칸을 바로 고칠 수 있습니다. 총괄표는 가로, 추천 의견서는 세로로 함께 출력됩니다.</p>
              <div className="sheet-wrap">
                <SheetFit fitHeight={false} minScale={0.5}>
                <Form2Sheet
                  subjectName={sum.subjectName}
                  publishers={sum.publishers}
                  members={memberCols}
                  matrix={sum.matrix}
                  headerMode={master.settings.memberHeaderMode}
                  decimals={master.settings.averageDecimals}
                  writer={sum.writer}
                  checker={sum.checker}
                  sortByAverage={sortByAvg}
                  onCellChange={changeCell}
                />
                </SheetFit>
                <SheetFit fitHeight={false} minScale={0.5}>
                <Form3Sheet
                  variant="official"
                  subjectName={sum.subjectName}
                  publishers={sum.publishers}
                  rows={sum.recommendDoc}
                  writer={sum.recommendWriter}
                  checker={sum.recommendChecker}
                  onTextChange={(rank, v) => update({ recommendDoc: sum.recommendDoc.map((r) => (r.rank === rank ? { ...r, text: v } : r)) })}
                  onPubChange={(rank, pid) => update({ recommendDoc: sum.recommendDoc.map((r) => (r.rank === rank ? { ...r, pubId: pid || null } : r)) })}
                  onOpinionClick={(rank) => setModalRank(rank)}
                />
                </SheetFit>
              </div>
            </div>
          )}
        </div>
      </div>

      {renderModal()}
      {notice && (
        <NoticeModal
          title={notice.title}
          tone={notice.tone}
          confirmLabel={notice.confirmLabel}
          onConfirm={notice.onConfirm}
          cancelLabel={notice.tone === 'info' ? '돌아가서 검토' : '닫기'}
          onClose={() => setNotice(null)}
        >
          <ul className="notice-list">
            {notice.lines.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </NoticeModal>
      )}
    </div>
  )
}
