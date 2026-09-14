import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocPublisher, Evaluation, RecommendItem, SchoolLevel } from '../types'
import { uid } from '../seed'
import { fmtDate, useAppData } from '../store/useAppData'
import { lsGet, lsSet } from '../store/storage'
import { buildDraftScores, checkScoreEdit, criteriaFor, publishersFor } from '../lib/scoring'
import { downloadText, readFileText } from '../lib/csv'
import { printSheetsInTurn } from '../lib/print'
import { SubjectSearch } from '../components/SubjectSearch'
import { Form1Sheet } from '../components/Form1Sheet'
import { Form3Sheet } from '../components/Form3Sheet'
import { OpinionModal } from '../components/OpinionModal'
import { HeaderSlot } from '../components/HeaderSlot'
import { SheetFit } from '../components/SheetFit'
import { PrinterIcon } from '../components/Icons'
import { NoticeModal } from '../components/NoticeModal'

const STEPS = ['선정 평가표', '추천 의견서', '인쇄·저장']
const NAME_KEY = 'choice.teacherName'
const SCHOOL_KEY = 'choice.schoolLevel'
const pubsKey = (subjectId: string) => `choice.pubs.${subjectId}`

type Msg = { type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null
/** 열려 있는 의견 작성 창 */
type OpenModal = { kind: 'summary' } | { kind: 'recommend'; rank: number } | null
/** 안내 창: 점수 수정 제한 / 인쇄 전 확인 */
type Notice = { title: string; tone: 'warn' | 'info'; lines: string[]; confirmLabel?: string; onConfirm?: () => void } | null

const DRAFT_NOTE = '자동으로 만든 초안입니다. 반드시 검토한 뒤 사용해 주세요.'

export function Personal({ go }: { go: (h: string) => void }) {
  const { master, evaluations, saveEvaluation, deleteEvaluation } = useAppData()
  const [step, setStep] = useState(0)
  const [ev, setEv] = useState<Evaluation | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [modal, setModal] = useState<OpenModal>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [sideOpen, setSideOpen] = useState(true)
  const saveTimer = useRef<number | null>(null)

  // 기본정보
  const [teacherName, setTeacherName] = useState('')
  const [school, setSchool] = useState<SchoolLevel | null>(null)
  const [subjectId, setSubjectId] = useState('')
  const [customSubject, setCustomSubject] = useState('')
  const [pubs, setPubs] = useState<DocPublisher[]>([])
  const [ranks, setRanks] = useState<(string | null)[]>([null, null, null])

  useEffect(() => {
    const saved = lsGet<string>(NAME_KEY, '')
    if (saved) setTeacherName(saved)
    const lv = lsGet<SchoolLevel | null>(SCHOOL_KEY, null)
    if (lv === '중' || lv === '고') setSchool(lv)
  }, [])

  /** 중·고 를 고르면 그 학교 과목만 찾는다 (한 번 고르면 기억한다) */
  const pickSchool = (lv: SchoolLevel) => {
    setSchool(lv)
    lsSet(SCHOOL_KEY, lv)
    if (subjectId) pickSubject('')
  }

  // 학교 목록에 과목이 없으면 이름을 직접 적어 쓸 수 있다
  const listed = master.subjects.find((s) => s.id === subjectId)
  const subject = listed || (customSubject.trim() ? { id: `custom-${customSubject.trim()}`, name: customSubject.trim(), gradeGroup: '3' as const, subjectGroup: '' } : undefined)
  const subjectGroup = subject?.subjectGroup || ''
  const namedPubs = useMemo(() => pubs.filter((p) => p.name.trim()).map((p) => ({ id: p.id, name: p.name.trim() })), [pubs])
  const criteria = useMemo(() => (subject ? criteriaFor(master, subject.id) : []), [master, subject])

  /** 과목을 고르면 출판사 목록을 채운다: 학교 공유 목록 → 이 컴퓨터 기록 → 빈 칸 3개 */
  const pickSubject = (id: string) => {
    setSubjectId(id)
    if (id) setCustomSubject('')
    setRanks([null, null, null])
    setEv(null)
    latest.current = null
    if (!id) return setPubs([])
    const shared = publishersFor(master, id).map((p) => ({ id: p.id, name: p.name }))
    const remembered = lsGet<DocPublisher[]>(pubsKey(id), [])
    const start = shared.length ? shared : remembered
    setPubs(start.length ? start : [{ id: uid(), name: '' }, { id: uid(), name: '' }, { id: uid(), name: '' }])
  }

  // 자동 저장 (디바운스 1초)
  const latest = useRef<Evaluation | null>(null)
  const update = (patch: Partial<Evaluation> | ((prev: Evaluation) => Partial<Evaluation>)) => {
    const prev = latest.current
    if (!prev) return
    const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
    latest.current = next
    setEv(next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveEvaluation(next).catch((e) => setMsg({ type: 'error', text: `저장 실패: ${e.message}` }))
    }, 1000)
  }
  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    },
    [],
  )

  /**
   * 이름·과목·출판사(2곳 이상)·1순위가 갖춰지면 평가표를 만든다.
   * 순위를 바꾸면 점수 초안을 다시 뽑고, 출판사를 더하면 기존 점수는 그대로 둔다.
   */
  useEffect(() => {
    if (!subject || !teacherName.trim() || namedPubs.length < 2 || !ranks[0]) return
    const prev = latest.current
    const sameShape =
      !!prev &&
      prev.subjectId === subject.id &&
      prev.teacherName === teacherName.trim() &&
      prev.publishers.length === namedPubs.length &&
      prev.publishers.every((p, i) => p.id === namedPubs[i].id && p.name === namedPubs[i].name)
    const ranksSame = !!prev && prev.ranks.join('|') === ranks.join('|')
    if (sameShape && ranksSame) return

    const base = { subjectId: subject.id, teacherName: teacherName.trim(), ranks }
    const scores = buildDraftScores(master.settings, criteria, namedPubs, base)
    // 순위가 그대로면(출판사만 늘거나 이름이 바뀌면) 손으로 고친 점수를 살린다
    if (prev && ranksSame) for (const p of namedPubs) if (prev.scores[p.id]) scores[p.id] = prev.scores[p.id]

    const recommend: RecommendItem[] = [1, 2, 3].map((r) => {
      const old = prev?.recommend.find((x) => x.rank === r)
      return {
        rank: r as 1 | 2 | 3,
        pubId: ranks[r - 1] || null,
        keys: old?.keys || [],
        strength: old?.strength || (r === 1 ? '적극 추천' : r === 2 ? '추천' : '대안으로 추천'),
        text: old?.text || '',
      }
    })

    const next: Evaluation = {
      id: prev?.id || uid(),
      ...base,
      subjectName: subject.name,
      publishers: namedPubs,
      criteria,
      scores,
      summaryKeys: prev?.summaryKeys || [],
      summaryOpinion: prev?.summaryOpinion || '',
      recommend,
      updatedAt: new Date().toISOString(),
    }
    latest.current = next
    setEv(next)
    lsSet(NAME_KEY, teacherName.trim())
    lsSet(pubsKey(subject.id), namedPubs)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveEvaluation(next).catch(() => undefined), 1000)
  }, [subject, teacherName, ranks, namedPubs, criteria, master.settings, saveEvaluation])

  // 좁은 화면: 입력이 끝난 단계(2·3단계)에서는 입력 칸을 접어 문서가 바로 보이게 한다
  useEffect(() => {
    if (!window.matchMedia('(max-width: 760px)').matches) return
    setSideOpen(step === 0)
  }, [step])

  const myDocs = useMemo(() => [...evaluations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [evaluations])

  const setPubName = (id: string, name: string) => setPubs((list) => list.map((p) => (p.id === id ? { ...p, name } : p)))
  const addPub = () => setPubs((list) => [...list, { id: uid(), name: '' }])
  const removePub = (id: string) => {
    setPubs((list) => list.filter((p) => p.id !== id))
    setRanks((r) => r.map((x) => (x === id ? null : x)))
  }

  // 직접 입력한 과목이면 출판사 칸을 비워 둔 채로 시작한다
  useEffect(() => {
    if (listed || !customSubject.trim()) return
    setPubs((prev) => (prev.length ? prev : [{ id: uid(), name: '' }, { id: uid(), name: '' }, { id: uid(), name: '' }]))
  }, [listed, customSubject])

  const loadDoc = (e: Evaluation) => {
    latest.current = e
    setEv(e)
    setSubjectId(master.subjects.some((s) => s.id === e.subjectId) ? e.subjectId : '')
    setCustomSubject(master.subjects.some((s) => s.id === e.subjectId) ? '' : e.subjectName)
    setPubs(e.publishers)
    setRanks(e.ranks)
    setTeacherName(e.teacherName)
    setStep(0)
    setMsg(null)
  }

  const importJson = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    try {
      const raw = JSON.parse(await readFileText(f)) as Evaluation
      if (!raw.id || !raw.scores || !raw.publishers?.length || !raw.criteria?.length) throw new Error('평가표 파일이 아닙니다.')
      await saveEvaluation(raw)
      loadDoc(raw)
      setMsg({ type: 'ok', text: `${raw.teacherName} 선생님의 ${raw.subjectName} 평가표를 불러왔습니다.` })
    } catch (e) {
      setMsg({ type: 'error', text: `불러오기 실패: ${(e as Error).message}` })
    }
  }

  const exportJson = () => {
    if (!ev) return
    downloadText(`평가표_${ev.subjectName}_${ev.teacherName}.json`, JSON.stringify(ev, null, 2), 'application/json')
  }

  const remove = async (id: string) => {
    if (!confirm('이 문서를 삭제할까요? 되돌릴 수 없습니다.')) return
    await deleteEvaluation(id)
    if (ev?.id === id) {
      latest.current = null
      setEv(null)
      setStep(0)
    }
  }

  const pubName = (id: string | null) => ev?.publishers.find((p) => p.id === id)?.name || ''
  const ready = !!ev

  /** 점수 수정: 배점을 넘거나 순위가 뒤집히면 넣지 않고 이유를 알려 준다 */
  const changeScore = (pubId: string, critId: string, v: number) => {
    if (!ev) return
    const put = (n: number) => update({ scores: { ...ev.scores, [pubId]: { ...(ev.scores[pubId] || {}), [critId]: n } } })
    const check = checkScoreEdit(ev, pubId, critId, v)
    if (check.ok) return put(v)
    setNotice({
      title: '이 점수는 넣을 수 없습니다',
      tone: 'warn',
      lines: check.lines,
      confirmLabel: check.suggestion === null ? undefined : `${check.suggestion}점으로 넣기`,
      onConfirm: check.suggestion === null ? undefined : () => {
        put(check.suggestion as number)
        setNotice(null)
      },
    })
  }

  /**
   * 인쇄 전에 책임·검토를 한 번 짚어 준다.
   * 평가표와 추천 의견서는 따로 저장한다 — 총괄 선생님이 위원들의 평가표만 모아 올리기 쉽도록.
   */
  const askPrint = () => {
    if (!ev) return
    setNotice({
      title: '인쇄하기 전에 확인해 주세요',
      tone: 'info',
      lines: [
        '이 서류의 최종 책임은 작성자 본인에게 있습니다.',
        '자동으로 만든 초안입니다. 점수와 문장이 실제 검토 결과와 맞는지 반드시 확인하고 고친 뒤 제출해 주세요.',
        '이름 · 과목 · 출판사 · 순위가 맞는지 다시 한 번 살펴 주세요.',
        '인쇄 창이 두 번 열립니다. 먼저 선정 평가표(가로 1쪽), 이어서 추천 의견서(세로 1쪽)를 각각 저장해 주세요.',
      ],
      confirmLabel: '확인했습니다, 인쇄',
      onConfirm: () => {
        setNotice(null)
        void printSheetsInTurn([
          { selector: '.form-sheet.form1', title: `선정 평가표_${ev.subjectName}_${ev.teacherName}` },
          { selector: '.form-sheet.form3', title: `추천 의견서_${ev.subjectName}_${ev.teacherName}` },
        ])
      },
    })
  }

  const goNext = () => {
    if (!ready) return setMsg({ type: 'warn', text: '이름·과목·출판사(2곳 이상)·1순위를 채우면 평가표가 만들어집니다.' })
    setMsg(null)
    setStep(1)
  }

  // ───────────── 의견 작성 창 ─────────────
  const renderModal = () => {
    if (!modal || !ev) return null
    if (modal.kind === 'summary') {
      return (
        <OpinionModal
          title={`종합의견 — ${ev.subjectName}`}
          scope="summary"
          kind="summary"
          subjectName={ev.subjectName}
          subjectGroup={subjectGroup}
          publisherName={pubName(ev.ranks[0])}
          rank={1}
          options={master.opinionOptions}
          settings={master.settings}
          initialKeys={ev.summaryKeys}
          initialText={ev.summaryOpinion}
          onCancel={() => setModal(null)}
          onApply={({ text, keys }) => {
            update({ summaryOpinion: text, summaryKeys: keys })
            setModal(null)
          }}
        />
      )
    }
    const item = ev.recommend.find((r) => r.rank === modal.rank)
    if (!item) return null
    return (
      <OpinionModal
        title={`${item.rank}순위 추천의견 — ${pubName(item.pubId) || '출판사 미선택'}`}
        scope="recommend"
        kind="recommend"
        subjectName={ev.subjectName}
        subjectGroup={subjectGroup}
        publisherName={pubName(item.pubId)}
        rank={item.rank}
        options={master.opinionOptions}
        settings={master.settings}
        initialKeys={item.keys}
        initialText={item.text}
        initialStrength={item.strength}
        avoid={ev.recommend.filter((r) => r.rank !== item.rank && r.text).map((r) => r.text)}
        notice={item.pubId ? undefined : '이 순위의 출판사를 먼저 표에서 고르면 문장을 생성할 수 있습니다.'}
        onCancel={() => setModal(null)}
        onApply={({ text, keys, strength }) => {
          update((prev) => ({
            recommend: prev.recommend.map((r) => (r.rank === item.rank ? { ...r, text, keys, strength: strength || r.strength } : r)),
          }))
          setModal(null)
        }}
      />
    )
  }

  return (
    <div>
      <HeaderSlot>
        <div className="steps">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`}
              onClick={() => ready && setStep(i)}
              style={{ cursor: ready ? 'pointer' : 'default' }}
              title={ev ? `저장됨 ${fmtDate(ev.updatedAt)}` : undefined}
            >
              {i + 1}. {s}
            </span>
          ))}
        </div>
      </HeaderSlot>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <button className="btn sm side-toggle no-print" onClick={() => setSideOpen((v) => !v)}>
        {sideOpen ? '입력 칸 접기 ▲' : '입력 칸 열기 ▼'}
      </button>

      <div className="work-layout">
        {/* 왼쪽: 입력 사이드바 (모든 단계에서 그대로 보인다) */}
        <aside className={`work-side no-print ${sideOpen ? '' : 'closed'}`}>
          <div className="card side-card">
            <h3>기본정보</h3>
            <label className="field">
              이름
              <input type="text" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder="홍길동" />
            </label>
            <div className="field">
              학교
              <div className="seg">
                <button className={school === '중' ? 'on' : ''} onClick={() => pickSchool('중')}>
                  중학교
                </button>
                <button className={school === '고' ? 'on' : ''} onClick={() => pickSchool('고')}>
                  고등학교
                </button>
              </div>
            </div>
            <div className="field">
              과목
              {master.subjects.length > 0 ? (
                <SubjectSearch subjects={master.subjects} value={subjectId} onChange={pickSubject} school={school} />
              ) : (
                <input type="text" value={customSubject} onChange={(e) => setCustomSubject(e.target.value)} placeholder="예: 세계사" />
              )}
            </div>
            {master.subjects.length > 0 && !listed && (
              <label className="field">
                목록에 없으면 직접 입력
                <input type="text" value={customSubject} onChange={(e) => setCustomSubject(e.target.value)} placeholder="예: 세계사" />
              </label>
            )}

            {subject && (
              <>
                <h3 style={{ marginTop: 16 }}>순위</h3>
                {[0, 1, 2].map((i) => (
                  <label className="field rank-row" key={i}>
                    <span className="rank-label">{i + 1}순위</span>
                    <select
                      value={ranks[i] || ''}
                      onChange={(e) => {
                        const next = [...ranks]
                        next[i] = e.target.value || null
                        setRanks(next)
                      }}
                    >
                      <option value="">-</option>
                      {namedPubs.map((p) => (
                        <option key={p.id} value={p.id} disabled={ranks.some((r, j) => j !== i && r === p.id)}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}

                <h3 style={{ marginTop: 16 }}>출판사</h3>
                <div className="pub-list">
                  {pubs.map((p, i) => (
                    <div className="pub-item" key={p.id}>
                      <input type="text" value={p.name} placeholder={`출판사 ${i + 1}`} onChange={(e) => setPubName(p.id, e.target.value)} />
                      <button className="icon-x" onClick={() => removePub(p.id)} aria-label="삭제" title="삭제">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button className="btn sm" style={{ marginTop: 8 }} onClick={addPub}>
                  + 출판사 추가
                </button>
              </>
            )}

            {ev && (
              <div className="side-actions">
                <button className="btn sm danger" onClick={() => remove(ev.id)}>
                  이 문서 삭제
                </button>
              </div>
            )}
          </div>

          {!ev && myDocs.length > 0 && (
            <div className="card side-card">
              <h3>이 컴퓨터의 문서</h3>
              {myDocs.map((e) => (
                <div className="side-doc" key={e.id}>
                  <div>
                    <b>{e.subjectName || '?'}</b> <span className="muted small">{e.teacherName}</span>
                    <div className="muted small">{fmtDate(e.updatedAt)}</div>
                  </div>
                  <div>
                    <button className="btn sm" onClick={() => loadDoc(e)}>
                      열기
                    </button>{' '}
                    <button className="btn sm danger" onClick={() => remove(e.id)}>
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
          {!ev && (
            <div className="card empty-hint">
              <h2>선정 평가표</h2>
              <p className="muted small">입력 칸에 이름·과목·출판사(2곳 이상)를 넣고 1순위를 고르면 평가표가 바로 만들어집니다.</p>
            </div>
          )}

          {ev && step === 0 && (
            <div className="card">
              <div className="main-head">
                <h2>선정 평가표</h2>
                <span className="ai-note">{DRAFT_NOTE}</span>
                <div className="main-head-actions">
                  <button className="btn primary" onClick={goNext}>
                    다음: 추천 의견서
                  </button>
                </div>
              </div>
              <p className="muted small">점수 칸을 클릭해 고칠 수 있습니다. 맨 아래 종합의견 칸을 클릭하면 의견 작성 창이 열립니다.</p>
              <p className="swipe-hint">표가 화면보다 넓으면 옆으로 밀어서 볼 수 있어요.</p>
              <SheetFit>
                <Form1Sheet
                  subjectName={ev.subjectName}
                  teacherName={ev.teacherName}
                  criteria={ev.criteria}
                  publishers={ev.publishers}
                  scores={ev.scores}
                  opinion={ev.summaryOpinion}
                  onScoreChange={changeScore}
                  onOpinionChange={(v) => update({ summaryOpinion: v })}
                  onOpinionClick={() => setModal({ kind: 'summary' })}
                />
              </SheetFit>
            </div>
          )}

          {ev && step === 1 && (
            <div className="card">
              <div className="main-head">
                <h2>추천 의견서</h2>
                <span className="ai-note">{DRAFT_NOTE}</span>
                <div className="main-head-actions">
                  <button className="btn" onClick={() => setStep(0)}>
                    이전
                  </button>
                  <button className="btn primary" onClick={() => setStep(2)}>
                    다음: 인쇄·저장
                  </button>
                </div>
              </div>
              <p className="muted small">순위별 출판사는 자동으로 채워졌습니다. 의견 칸을 클릭하면 의견 작성 창이 열립니다.</p>
              <p className="swipe-hint">서식이 화면보다 넓으면 옆으로 밀어서 볼 수 있어요.</p>
              <SheetFit>
                <Form3Sheet
                  variant="personal"
                  subjectName={ev.subjectName}
                  teacherName={ev.teacherName}
                  publishers={ev.publishers}
                  rows={ev.recommend}
                  writer={{ position: '교사', name: ev.teacherName }}
                  checker={{ position: '', name: '' }}
                  onTextChange={(rank, v) => update({ recommend: ev.recommend.map((r) => (r.rank === rank ? { ...r, text: v } : r)) })}
                  onPubChange={(rank, pid) => update({ recommend: ev.recommend.map((r) => (r.rank === rank ? { ...r, pubId: pid || null } : r)) })}
                  onOpinionClick={(rank) => setModal({ kind: 'recommend', rank })}
                />
              </SheetFit>
            </div>
          )}

          {ev && step === 2 && (
            <div className="card">
              <div className="main-head">
                <h2>인쇄·저장</h2>
                <span className="ai-note">{DRAFT_NOTE}</span>
                <div className="main-head-actions">
                  <button className="btn" onClick={() => setStep(1)}>
                    이전
                  </button>
                  <button className="btn primary" onClick={askPrint}>
                    <PrinterIcon /> 인쇄 · PDF 저장
                  </button>
                  <button className="btn" onClick={exportJson}>
                    JSON 내보내기
                  </button>
                </div>
              </div>
              <p className="muted small">여기서도 점수 칸과 의견 칸을 바로 고칠 수 있습니다. [인쇄 · PDF 저장]을 누르면 인쇄 창이 두 번 열려 <b>선정 평가표(가로 1쪽)</b>와 <b>추천 의견서(세로 1쪽)</b>를 각각 저장합니다 — 인쇄 창에서 대상을 'PDF로 저장'으로 고르면 총괄 선생님께 보낼 파일이 됩니다.</p>
              <div className="sheet-wrap">
                <SheetFit fitHeight={false} minScale={0.5}>
                <Form1Sheet
                  subjectName={ev.subjectName}
                  teacherName={ev.teacherName}
                  criteria={ev.criteria}
                  publishers={ev.publishers}
                  scores={ev.scores}
                  opinion={ev.summaryOpinion}
                  onScoreChange={changeScore}
                  onOpinionChange={(v) => update({ summaryOpinion: v })}
                  onOpinionClick={() => setModal({ kind: 'summary' })}
                />
                </SheetFit>
                <SheetFit fitHeight={false} minScale={0.5}>
                <Form3Sheet
                  variant="personal"
                  subjectName={ev.subjectName}
                  teacherName={ev.teacherName}
                  publishers={ev.publishers}
                  rows={ev.recommend}
                  writer={{ position: '교사', name: ev.teacherName }}
                  checker={{ position: '', name: '' }}
                  onTextChange={(rank, v) => update({ recommend: ev.recommend.map((r) => (r.rank === rank ? { ...r, text: v } : r)) })}
                  onPubChange={(rank, pid) => update({ recommend: ev.recommend.map((r) => (r.rank === rank ? { ...r, pubId: pid || null } : r)) })}
                  onOpinionClick={(rank) => setModal({ kind: 'recommend', rank })}
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
