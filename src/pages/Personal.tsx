import { useEffect, useMemo, useRef, useState } from 'react'
import type { Evaluation, RecommendItem, RecommendStrength } from '../types'
import { uid } from '../seed'
import { fmtDate, useAppData } from '../store/useAppData'
import { useAuth } from '../store/auth'
import { buildDraftScores, criteriaFor, publishersFor } from '../lib/scoring'
import { aiGenerate, getApiKey, splitKeys } from '../lib/ai'
import { downloadText } from '../lib/csv'
import { SubjectSelect } from '../components/SubjectSelect'
import { OpinionPicker } from '../components/OpinionPicker'
import { Form1Sheet } from '../components/Form1Sheet'
import { Form3Sheet } from '../components/Form3Sheet'

const STEPS = ['기본정보', '서식1 평가표', '추천의견(서식3)', '검토·제출']
const STRENGTHS: RecommendStrength[] = ['적극 추천', '추천', '대안으로 추천']

export function Personal() {
  const { master, evaluations, saveEvaluation, deleteEvaluation, mode, refresh } = useAppData()
  const { enabled: authEnabled, user, member, isAnonymous } = useAuth()
  // 구글 로그인으로 승인된 사람은 이름이 고정되고, 로그인 없이 쓰는 교사는 직접 입력한다
  const nameLocked = authEnabled && !isAnonymous && member?.status === 'approved'
  const [step, setStep] = useState(0)
  const [teacherName, setTeacherName] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [ranks, setRanks] = useState<(string | null)[]>([null, null, null])
  const [ev, setEv] = useState<Evaluation | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [length, setLength] = useState<'short' | 'long'>('short')
  const saveTimer = useRef<number | null>(null)

  // 승인된 계정은 그 이름을, 그 외에는 이 브라우저에 저장해 둔 이름을 쓴다
  useEffect(() => {
    if (nameLocked && member?.displayName) setTeacherName(member.displayName)
    else {
      try {
        const saved = localStorage.getItem('choice.teacherName')
        if (saved) setTeacherName(saved)
      } catch {
        /* ignore */
      }
    }
  }, [nameLocked, member])

  const subject = master.subjects.find((s) => s.id === (ev?.subjectId || subjectId))
  const publishers = useMemo(() => (subject ? publishersFor(master, subject.id) : []), [master, subject])
  const criteria = useMemo(() => (subject ? criteriaFor(master, subject.id) : []), [master, subject])
  const closed = subject?.status === 'closed'
  const readOnly = !!ev && (ev.status === 'submitted' || closed)

  // 자동 저장 (디바운스 1초). 최신 상태 기준으로 병합하여 연속 생성 시 덮어쓰기 방지
  const latest = useRef<Evaluation | null>(null)
  latest.current = ev
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

  const myDrafts = evaluations.filter((e) => (user ? e.uid === user.uid : !!teacherName.trim() && e.teacherName === teacherName.trim()))

  const createDraft = async () => {
    if (!teacherName.trim()) return setMsg({ type: 'warn', text: '교사명을 입력하세요.' })
    if (!subject) return setMsg({ type: 'warn', text: '과목을 선택하세요.' })
    if (publishers.length <= 1) return setMsg({ type: 'info', text: '출판사가 1곳(1책 1도서)인 과목은 의견 수렴이 필요하지 않습니다.' })
    if (closed) return setMsg({ type: 'warn', text: '이 과목은 총괄표가 확정되어 마감되었습니다.' })
    const picked = ranks.filter(Boolean) as string[]
    if (new Set(picked).size !== picked.length) return setMsg({ type: 'warn', text: '순위에 같은 출판사를 중복 선택할 수 없습니다.' })
    if (!ranks[0]) return setMsg({ type: 'warn', text: '1순위 출판사를 선택하세요.' })
    const existing = evaluations.find((e) => e.teacherName === teacherName.trim() && e.subjectId === subject.id)
    if (existing) {
      if (!confirm('같은 과목의 문서가 이미 있습니다. 새 초안으로 덮어쓸까요? (취소하면 기존 문서를 불러옵니다)')) {
        return loadDraft(existing)
      }
    }
    if (!nameLocked) {
      try {
        localStorage.setItem('choice.teacherName', teacherName.trim())
      } catch {
        /* ignore */
      }
    }
    const base = { subjectId: subject.id, teacherName: teacherName.trim(), ranks }
    const scores = buildDraftScores(master, base)
    const recommend: RecommendItem[] = [1, 2, 3].map((r) => ({
      rank: r as 1 | 2 | 3,
      pubId: ranks[r - 1] || null,
      keys: [],
      strength: r === 1 ? '적극 추천' : r === 2 ? '추천' : '대안으로 추천',
      text: '',
    }))
    const next: Evaluation = {
      id: existing?.id || uid(),
      ...base,
      uid: user?.uid,
      scores,
      summaryKeys: [],
      summaryOpinion: '',
      recommend,
      status: 'draft',
      aiCount: 0,
      updatedAt: new Date().toISOString(),
    }
    await saveEvaluation(next)
    setEv(next)
    setMsg({ type: 'info', text: '초안이 생성되었습니다. 점수와 의견은 초안이며 실제 검토 결과에 맞게 수정하세요.' })
    setStep(1)
  }

  const loadDraft = async (e: Evaluation) => {
    setEv(e)
    setSubjectId(e.subjectId)
    setRanks(e.ranks)
    setStep(e.status === 'submitted' ? 3 : 1)
    setMsg(null)
  }

  const generateSummary = async () => {
    if (!ev || !subject) return
    if (ev.aiCount >= master.settings.aiMaxPerDoc && getApiKey()) {
      setMsg({ type: 'warn', text: `문서당 AI 생성 상한(${master.settings.aiMaxPerDoc}회)에 도달하여 규칙 기반 문장으로 생성합니다.` })
    }
    setBusy(true)
    const { positives, negatives } = splitKeys(master.opinionOptions, ev.summaryKeys)
    const p1 = publishers.find((p) => p.id === ev.ranks[0])
    const res = await aiGenerate(
      { kind: 'summary', subject: subject.name, publisher: p1?.name, rank: 1, positives, negatives, tone: master.settings.tone, length },
      master.settings.aiModel,
      master.settings.aiFallbackModel,
    )
    setBusy(false)
    update((prev) => ({ summaryOpinion: res.text, aiCount: prev.aiCount + (res.source === 'ai' ? 1 : 0) }))
    setMsg(res.source === 'ai' ? { type: 'ok', text: 'AI가 문장을 생성했습니다. 내용을 확인·수정하세요.' } : { type: 'info', text: `규칙 기반 문장으로 생성했습니다${res.error && res.error !== 'API 키 없음' ? ` (AI 오류: ${res.error})` : ''}.` })
  }

  const generateRecommend = async (rank: number) => {
    if (!ev || !subject) return
    const item = ev.recommend.find((r) => r.rank === rank)
    if (!item) return
    setBusy(true)
    const { positives, negatives } = splitKeys(master.opinionOptions, item.keys)
    const pub = publishers.find((p) => p.id === item.pubId)
    const avoid = ev.recommend.filter((r) => r.rank !== rank && r.text).map((r) => r.text)
    const res = await aiGenerate(
      { kind: 'recommend', subject: subject.name, publisher: pub?.name, rank, positives, negatives, strength: item.strength, tone: master.settings.tone, length, avoid },
      master.settings.aiModel,
      master.settings.aiFallbackModel,
    )
    setBusy(false)
    update((prev) => ({
      recommend: prev.recommend.map((r) => (r.rank === rank ? { ...r, text: res.text } : r)),
      aiCount: prev.aiCount + (res.source === 'ai' ? 1 : 0),
    }))
    setMsg(res.source === 'ai' ? { type: 'ok', text: 'AI가 문장을 생성했습니다.' } : { type: 'info', text: '규칙 기반 문장으로 생성했습니다.' })
  }

  const submit = async () => {
    if (!ev) return
    if (!ev.summaryOpinion.trim() && !confirm('종합의견이 비어 있습니다. 그대로 제출할까요?')) return
    const next: Evaluation = { ...ev, status: 'submitted', submittedAt: new Date().toISOString() }
    await saveEvaluation(next)
    setEv(next)
    setMsg({ type: 'ok', text: '제출되었습니다. 총괄표 생성 전까지 제출 취소가 가능합니다.' })
  }
  const unsubmit = async () => {
    if (!ev) return
    if (closed) return setMsg({ type: 'warn', text: '과목이 마감되어 제출을 취소할 수 없습니다.' })
    const next: Evaluation = { ...ev, status: 'draft', submittedAt: undefined }
    await saveEvaluation(next)
    setEv(next)
    setStep(1)
    setMsg({ type: 'info', text: '제출이 취소되었습니다. 수정 후 다시 제출하세요.' })
  }
  const exportJson = () => {
    if (!ev || !subject) return
    downloadText(`제출_${subject.name}_${ev.teacherName}.json`, JSON.stringify(ev, null, 2), 'application/json')
  }
  const remove = async () => {
    if (!ev) return
    if (!confirm('이 문서를 삭제할까요?')) return
    await deleteEvaluation(ev.id)
    setEv(null)
    setStep(0)
  }

  const subjectGroup = subject?.subjectGroup || ''

  return (
    <div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <span key={s} className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`} onClick={() => ev && setStep(i)} style={{ cursor: ev ? 'pointer' : 'default' }}>
            {i + 1}. {s}
          </span>
        ))}
        <span className="spacer" />
        {ev && (
          <span className={`badge ${ev.status === 'submitted' ? 'ok' : 'warn'}`}>
            {ev.status === 'submitted' ? `제출됨 ${fmtDate(ev.submittedAt)}` : '임시저장'}
            {closed ? ' · 과목 마감' : ''}
          </span>
        )}
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      {step === 0 && (
        <div className="grid2">
          <div className="card">
            <h2>기본정보</h2>
            <label className="field">
              교사명(위원)
              <input
                type="text"
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
                placeholder="홍길동"
                readOnly={nameLocked}
                title={nameLocked ? '승인된 계정 이름이 위원명으로 사용됩니다.' : undefined}
              />
            </label>
            <p className="note" style={{ marginTop: 6 }}>
              {nameLocked
                ? '로그인한 계정의 승인된 이름이 위원명으로 사용됩니다.'
                : '제출에는 로그인이 필요 없습니다. 작성한 문서는 이 브라우저에서만 다시 열 수 있으니 제출 전에 마무리해 주세요.'}
            </p>
            <label className="field" style={{ marginTop: 10 }}>
              과목
              <SubjectSelect subjects={master.subjects} value={subjectId} onChange={(id) => { setSubjectId(id); setRanks([null, null, null]) }} />
            </label>
            {subject && publishers.length <= 1 && (
              <div className="alert info" style={{ marginTop: 10 }}>
                {publishers.length === 0 ? '이 과목에는 아직 출판사가 등록되지 않았습니다. 관리자에게 문의하세요.' : '1책 1도서(출판사 1곳) 과목으로 의견 수렴이 불필요합니다.'}
              </div>
            )}
            {subject && publishers.length > 1 && (
              <div className="row" style={{ marginTop: 10 }}>
                {[0, 1, 2].map((i) => (
                  <label className="field" key={i}>
                    {i + 1}순위 출판사{i > 0 ? ' (선택)' : ''}
                    <select
                      value={ranks[i] || ''}
                      onChange={(e) => {
                        const next = [...ranks]
                        next[i] = e.target.value || null
                        setRanks(next)
                      }}
                    >
                      <option value="">-</option>
                      {publishers.map((p) => (
                        <option key={p.id} value={p.id} disabled={ranks.some((r, j) => j !== i && r === p.id)}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <div className="actions">
              <button className="btn primary lg" onClick={createDraft} disabled={!subject || publishers.length <= 1}>
                초안 생성
              </button>
              {mode === 'supabase' && (
                <button className="btn" onClick={refresh}>
                  새로고침
                </button>
              )}
            </div>
            <p className="note">순위를 바탕으로 점수표와 의견 초안이 채워집니다. 초안은 편집 전제이며 실제 검토 결과에 맞게 수정하세요.</p>
          </div>
          <div className="card">
            <h2>내 문서 불러오기</h2>
            {!authEnabled && !teacherName.trim() && <p className="muted small">교사명을 입력하면 본인의 임시저장·제출 문서가 표시됩니다.</p>}
            {(authEnabled || teacherName.trim()) && myDrafts.length === 0 && <p className="muted small">저장된 문서가 없습니다.</p>}
            {myDrafts.length > 0 && (
              <table className="data">
                <thead>
                  <tr>
                    <th>과목</th>
                    <th>상태</th>
                    <th>수정일시</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {myDrafts.map((e) => (
                    <tr key={e.id}>
                      <td>{master.subjects.find((s) => s.id === e.subjectId)?.name || '?'}</td>
                      <td>{e.status === 'submitted' ? <span className="badge ok">제출</span> : <span className="badge warn">임시저장</span>}</td>
                      <td>{fmtDate(e.updatedAt)}</td>
                      <td>
                        <button className="btn sm" onClick={() => loadDraft(e)}>
                          불러오기
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="note">계획서 비공개 원칙에 따라 다른 위원의 점수·의견은 조회할 수 없습니다.</p>
          </div>
        </div>
      )}

      {ev && subject && step === 1 && (
        <div>
          <div className="card">
            <h2>서식1 선정 평가표 {readOnly && <span className="badge gray">읽기 전용</span>}</h2>
            <p className="muted small">셀을 클릭하면 점수를 수정할 수 있습니다. 배점을 초과하면 붉게 표시됩니다. 변경 내용은 자동 저장됩니다.</p>
            <div className="sheet-wrap">
              <Form1Sheet
                subjectName={subject.name}
                teacherName={ev.teacherName}
                criteria={criteria}
                publishers={publishers}
                scores={ev.scores}
                opinion={ev.summaryOpinion}
                readOnly={readOnly}
                onScoreChange={(pid, cid, v) => update({ scores: { ...ev.scores, [pid]: { ...(ev.scores[pid] || {}), [cid]: v } } })}
                onOpinionChange={(v) => update({ summaryOpinion: v })}
              />
            </div>
          </div>
          <div className="card">
            <h3>종합의견 핵심의견 선택 → 의견 생성</h3>
            <OpinionPicker options={master.opinionOptions} scope="summary" subjectGroup={subjectGroup} selected={ev.summaryKeys} onChange={(k) => update({ summaryKeys: k })} disabled={readOnly} />
            <div className="actions">
              <select value={length} onChange={(e) => setLength(e.target.value as 'short' | 'long')} disabled={readOnly}>
                <option value="short">2~4문장</option>
                <option value="long">4~6문장</option>
              </select>
              <button className="btn primary" onClick={generateSummary} disabled={busy || readOnly}>
                {busy ? '생성 중…' : ev.summaryOpinion ? '다시 생성' : '의견 생성'}
              </button>
              <span className="muted small">{getApiKey() ? `AI 모델: ${master.settings.aiModel} (${ev.aiCount}/${master.settings.aiMaxPerDoc}회)` : 'AI 키 미설정 — 규칙 기반 문장으로 생성됩니다'}</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setStep(0)}>
                이전
              </button>
              <button className="btn primary" onClick={() => setStep(2)}>
                다음: 추천의견
              </button>
            </div>
          </div>
        </div>
      )}

      {ev && subject && step === 2 && (
        <div>
          <div className="card">
            <h2>개인 추천의견 (서식3 형식) {readOnly && <span className="badge gray">읽기 전용</span>}</h2>
            <p className="muted small">순위별 출판사는 기본정보의 순위에서 자동 채워졌습니다. 의견 칸을 클릭하여 직접 수정할 수 있습니다.</p>
            <div className="sheet-wrap">
              <Form3Sheet
                variant="personal"
                subjectName={subject.name}
                teacherName={ev.teacherName}
                publishers={publishers}
                rows={ev.recommend}
                writer={{ position: '교사', name: ev.teacherName }}
                checker={{ position: '', name: '' }}
                readOnly={readOnly}
                onTextChange={(rank, v) => update({ recommend: ev.recommend.map((r) => (r.rank === rank ? { ...r, text: v } : r)) })}
                onPubChange={(rank, pid) => update({ recommend: ev.recommend.map((r) => (r.rank === rank ? { ...r, pubId: pid || null } : r)) })}
              />
            </div>
          </div>
          {ev.recommend.map((item) => (
            <div className="card" key={item.rank}>
              <h3>
                {item.rank}순위 · {publishers.find((p) => p.id === item.pubId)?.name || '출판사 미선택'}
              </h3>
              <OpinionPicker
                options={master.opinionOptions}
                scope="recommend"
                subjectGroup={subjectGroup}
                selected={item.keys}
                onChange={(k) => update({ recommend: ev.recommend.map((r) => (r.rank === item.rank ? { ...r, keys: k } : r)) })}
                disabled={readOnly}
              />
              <div className="actions">
                <select value={item.strength} onChange={(e) => update({ recommend: ev.recommend.map((r) => (r.rank === item.rank ? { ...r, strength: e.target.value as RecommendStrength } : r)) })} disabled={readOnly}>
                  {STRENGTHS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button className="btn primary" onClick={() => generateRecommend(item.rank)} disabled={busy || readOnly || !item.pubId}>
                  {busy ? '생성 중…' : item.text ? '다시 생성' : '의견 생성'}
                </button>
              </div>
            </div>
          ))}
          <div className="actions">
            <button className="btn" onClick={() => setStep(1)}>
              이전
            </button>
            <button className="btn primary" onClick={() => setStep(3)}>
              다음: 검토·제출
            </button>
          </div>
        </div>
      )}

      {ev && subject && step === 3 && (
        <div>
          <div className="preview-toolbar card">
            <button className="btn" onClick={() => window.print()}>
              인쇄 / PDF 저장
            </button>
            <button className="btn" onClick={exportJson}>
              파일로 내보내기(JSON)
            </button>
            <span className="spacer" />
            {ev.status === 'draft' && !closed && (
              <>
                <button className="btn" onClick={() => setStep(2)}>
                  이전
                </button>
                <button className="btn danger" onClick={remove}>
                  삭제
                </button>
                <button className="btn primary lg" onClick={submit}>
                  제출
                </button>
              </>
            )}
            {ev.status === 'submitted' && !closed && (
              <button className="btn" onClick={unsubmit}>
                제출 취소
              </button>
            )}
            {closed && <span className="badge gray">과목 마감 — 수정 불가</span>}
          </div>
          <div className="sheet-wrap">
            <Form1Sheet subjectName={subject.name} teacherName={ev.teacherName} criteria={criteria} publishers={publishers} scores={ev.scores} opinion={ev.summaryOpinion} readOnly />
            {master.settings.printPersonalRecommend && (
              <Form3Sheet variant="personal" subjectName={subject.name} teacherName={ev.teacherName} publishers={publishers} rows={ev.recommend} writer={{ position: '교사', name: ev.teacherName }} checker={{ position: '', name: '' }} readOnly />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
