import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocPublisher, Person, SchoolLevel, Summary, SummaryMember, SummaryRecommend } from '../types'
import { uid } from '../seed'
import { fmtDate, useAppData } from '../store/useAppData'
import { lsGet, lsSet } from '../store/storage'
import { columnTotal, computeSummary, criteriaFor, publishersFor } from '../lib/scoring'
import { downloadText, readFileText } from '../lib/csv'
import { printSheetsInTurn } from '../lib/print'
import { hwpxWarning, saveCompileHwpx } from '../lib/hwpxDoc'
import { importMemberFiles, squeezeName, type ImportProgress } from '../lib/pdfImport'
import { SubjectSearch } from '../components/SubjectSearch'
import { Form1Sheet } from '../components/Form1Sheet'
import { Form2Sheet } from '../components/Form2Sheet'
import { Form3Sheet } from '../components/Form3Sheet'
import { OpinionModal } from '../components/OpinionModal'
import { HeaderSlot } from '../components/HeaderSlot'
import { SheetFit } from '../components/SheetFit'
import { HwpIcon, PrinterIcon } from '../components/Icons'
import { NoticeModal } from '../components/NoticeModal'

const STEPS = ['평가 총괄표', '추천 의견서']
const SCHOOL_KEY = 'choice.schoolLevel'
type Msg = { type: 'ok' | 'warn' | 'error' | 'info'; text: string } | null
/** 안내 창: 점수 수정 제한 / 인쇄 전 확인 */
type Notice = { title: string; tone: 'warn' | 'info'; lines: string[]; confirmLabel?: string; onConfirm?: () => void; closeLabel?: string } | null

const DRAFT_NOTE = '올린 평가표에서 계산한 초안입니다. 원본과 대조해 확인해 주세요.'

/** 위원 문서에서 이 출판사의 총점을 꺼낸다 (이름으로 맞춘다) */
function totalOf(member: SummaryMember, pubName: string): number | null {
  const ev = member.evaluation
  if (!ev) return null
  const pub = ev.publishers.find((p) => squeezeName(p.name) === squeezeName(pubName))
  if (!pub) return null
  return columnTotal(ev.scores[pub.id], ev.criteria)
}

export function Compile({ go }: { go: (h: string) => void }) {
  const { master, summaries, saveSummary, deleteSummary } = useAppData()
  const [step, setStep] = useState(0)
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
  const [school, setSchool] = useState<SchoolLevel | null>(() => {
    const lv = lsGet<SchoolLevel | null>(SCHOOL_KEY, null)
    return lv === '중' || lv === '고' ? lv : null
  })
  const [sideOpen, setSideOpen] = useState(true)
  const saveTimer = useRef<number | null>(null)

  // 좁은 화면: 추천 의견서 단계에서는 입력 칸을 접어 문서가 바로 보이게 한다
  useEffect(() => {
    if (!window.matchMedia('(max-width: 760px)').matches) return
    setSideOpen(step === 0)
  }, [step])

  const subject = master.subjects.find((s) => s.id === subjectId)
  const subjectGroup = subject?.subjectGroup || ''
  /** 과목을 골랐거나 직접 적었는가 — 평가표를 올리기 전에 반드시 정해야 한다 */
  const subjectReady = !!subject || subjectName.trim() !== ''
  const SUBJECT_FIRST = '과목을 먼저 골라 주세요. 위원 평가표의 출판사 이름을 교과서 자료 표기에 맞추고 과목이 맞는지 확인하는 데 필요합니다.'

  const latest = useRef<Summary | null>(null)
  /** 화면에 반영하고 잠시 뒤 저장한다 */
  const commit = (next: Summary) => {
    latest.current = next
    setSum(next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveSummary(next).catch((e) => setMsg({ type: 'error', text: `저장 실패: ${e.message}` })), 800)
  }
  const update = (patch: Partial<Summary> | ((prev: Summary) => Partial<Summary>)) => {
    const prev = latest.current
    if (!prev) return
    commit({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })
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

  /**
   * 인쇄 전에 책임·검토를 한 번 짚어 준다.
   * 서식마다 따로 인쇄한다 — 총괄표 단추는 총괄표만, 추천 의견서 단추는 의견서만.
   */
  const askPrint = (kind: 'form2' | 'form3') => {
    if (!sum) return
    const what = kind === 'form2' ? '평가 총괄표' : '추천 의견서'
    setNotice({
      title: `${what}를 인쇄하기 전에 확인해 주세요`,
      tone: 'info',
      lines: [
        '이 서류의 최종 책임은 작성자 본인에게 있습니다.',
        '위원들이 올린 평가표에서 자동으로 계산한 초안입니다. 총점 · 평균 · 순위를 원본과 대조한 뒤 제출해 주세요.',
        '위원 이름과 출판사명이 바르게 들어갔는지 다시 한 번 살펴 주세요.',
        `이 단추는 ${what}만 인쇄합니다.`,
      ],
      confirmLabel: '확인했습니다, 인쇄',
      onConfirm: () => {
        setNotice(null)
        void printSheetsInTurn([{ selector: `.form-sheet.${kind}`, title: `${what}_${sum.subjectName}` }])
      },
    })
  }

  /** 교육청 원본 한글 서식(서식2 + 서식3)에 값을 채워 .hwpx 로 내려받는다 */
  const saveHwpx = async () => {
    if (!sum) return
    const warn = hwpxWarning(sum.publishers.length, sum.members.length)
    if (warn) setMsg({ type: 'warn', text: warn })
    try {
      await saveCompileHwpx({
        subjectName: sum.subjectName,
        publishers: sum.publishers,
        members: sum.members,
        matrix: sum.matrix,
        decimals: master.settings.averageDecimals,
        recommendDoc: sum.recommendDoc,
      })
    } catch (e) {
      setMsg({ type: 'error', text: `한글 파일을 만들지 못했습니다. ${(e as Error).message}` })
    }
  }

  // ───────────── 파일 올리기 ─────────────
  const addFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return
    if (!subjectReady) return setMsg({ type: 'warn', text: SUBJECT_FIRST })
    setMsg(null)
    const { members: got, errors } = await importMemberFiles(list, setProgress, members)
    setProgress(null)
    // 올린 평가표의 과목이 고른 과목과 다르면 알려 준다 (다른 과목 파일이 섞이는 실수 방지)
    const chosen = squeezeName(subject?.name || subjectName)
    for (const m of got) {
      const got1 = m.evaluation?.subjectName || ''
      if (got1 && chosen && squeezeName(got1) !== chosen) m.warnings.unshift(`평가표의 과목은 '${got1}' 인데 고른 과목은 '${subject?.name || subjectName.trim()}' 입니다. 파일이 맞는지 확인해 주세요.`)
    }
    // 의견서만 온 파일이 기존 위원에 붙었을 수도 있으므로 목록을 새로 그린다
    setMembers((prev) => [...prev, ...got])
    // 과목은 먼저 고른 것을 그대로 쓴다 — 평가표의 과목이 다르면 위에서 경고만 붙인다
    const parts: string[] = []
    if (got.length) parts.push(`${got.length}명의 평가표를 읽었습니다.`)
    if (errors.length) parts.push(`읽지 못한 파일 ${errors.length}개: ${errors.map((e) => `${e.file} (${e.reason})`).join(' / ')}`)
    setMsg({ type: errors.length ? (got.length ? 'warn' : 'error') : 'ok', text: parts.join(' ') })
  }

  const addManual = () => {
    if (!subjectReady) return setMsg({ type: 'warn', text: SUBJECT_FIRST })
    const name = prompt('직접 추가할 위원 이름을 입력하세요.')
    if (!name?.trim()) return
    setMembers((prev) => [...prev, { id: uid(), teacherName: name.trim(), source: 'manual', warnings: ['점수를 직접 입력해야 합니다.'] }])
  }

  const removeMember = (id: string) => setMembers((prev) => prev.filter((m) => m.id !== id))

  /**
   * 올린 위원들의 출판사 합집합 (이름 기준, 먼저 올라온 순서).
   * PDF 에서 읽은 이름은 칸이 좁아 줄이 접히면 띄어쓰기가 사라지므로,
   * 고른 과목의 교과서 자료에 같은 이름이 있으면 그 표기를 쓴다.
   */
  const mergedPublishers = useMemo<DocPublisher[]>(() => {
    const official = subjectId ? publishersFor(master, subjectId) : []
    const spell = (name: string) => official.find((o) => squeezeName(o.name) === squeezeName(name))?.name || name
    const out: DocPublisher[] = []
    for (const m of members) {
      for (const p of m.evaluation?.publishers || []) {
        if (!out.some((x) => squeezeName(x.name) === squeezeName(p.name))) out.push({ id: uid(), name: spell(p.name) })
      }
    }
    return out
  }, [members, master, subjectId])

  const existing = summaries.find((s) => (subjectId ? s.subjectId === subjectId : s.subjectName === subjectName))

  /**
   * 올린 위원들로 총괄표를 만든다 — 위원을 올리거나 뺄 때마다 저절로 다시 만든다.
   * 손으로 고친 점수 칸과 추천 의견서는 (출판사 이름, 위원)이 같으면 그대로 이어받는다.
   */
  const rebuild = (list: SummaryMember[], base: Summary | null) => {
    const name = subject?.name || subjectName.trim()
    if (!name || !list.length || !mergedPublishers.length) return
    // 다른 과목으로 바꿨으면 앞 과목의 총괄표를 이어받지 않는다
    if (base && (base.subjectId || '') !== (subject?.id || '')) base = null
    const same = (a: string, b: string) => squeezeName(a) === squeezeName(b)
    // 출판사 id 는 이름이 같으면 이전 것을 그대로 쓴다 (추천 의견서 순위 연결이 끊기지 않게)
    const publishers = mergedPublishers.map((p) => {
      const old = base?.publishers.find((o) => same(o.name, p.name))
      return old ? { ...p, id: old.id } : p
    })
    const matrix: Summary['matrix'] = {}
    for (const pub of publishers) {
      matrix[pub.id] = {}
      for (const m of list) {
        const kept = base?.matrix[pub.id]?.[m.id]
        matrix[pub.id][m.id] = typeof kept === 'number' ? kept : totalOf(m, pub.name) ?? 0
      }
    }
    const blank: Person = { position: '', name: '' }
    const next: Summary = {
      id: base?.id || existing?.id || uid(),
      subjectId: subject?.id || '',
      subjectName: name,
      publishers,
      members: list,
      matrix,
      writer: blank,
      checker: blank,
      recommendDoc: base?.recommendDoc || ([1, 2, 3] as const).map((r) => ({ rank: r, pubId: null, text: '' })),
      recommendWriter: blank,
      recommendChecker: blank,
      updatedAt: new Date().toISOString(),
    }
    commit(next)
  }

  // 위원 목록·과목이 바뀌면 총괄표를 다시 만든다. 위원이 모두 빠지면 표를 내린다(저장본은 그대로).
  useEffect(() => {
    if (!subjectReady || !members.length) {
      if (!members.length && latest.current) {
        latest.current = null
        setSum(null)
        setStep(0)
      }
      return
    }
    rebuild(members, latest.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, mergedPublishers, subjectReady])

  const loadExisting = (s: Summary) => {
    latest.current = s
    setSum(s)
    setMembers(s.members)
    setSubjectId(s.subjectId)
    setSubjectName(s.subjectName)
    setStep(0)
    setMsg(null)
  }

  // 저장된 총괄표가 있는 과목을 고르면 이어서 열지 먼저 묻는다 (아직 올린 위원이 없을 때만)
  const askedFor = useRef('')
  useEffect(() => {
    if (!existing || members.length || sum || askedFor.current === existing.id) return
    askedFor.current = existing.id
    setNotice({
      title: '이 과목의 총괄표가 저장되어 있습니다',
      tone: 'info',
      lines: [
        `${existing.subjectName} · 위원 ${existing.members.length}명 · ${fmtDate(existing.updatedAt)} 저장`,
        '[이어서 열기]를 누르면 저장된 총괄표와 추천 의견서를 그대로 엽니다.',
        '새로 만들려면 창을 닫고 평가표 PDF를 올리세요. 새 총괄표가 저장본을 대신합니다.',
      ],
      confirmLabel: '이어서 열기',
      onConfirm: () => {
        setNotice(null)
        loadExisting(existing)
      },
      closeLabel: '새로 만들기',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, members.length, sum])

  /** 평가 결과(총괄표)에서 1~3순위 자리마다 들어갈 수 있는 출판사 */
  const rankSlots = useMemo(() => {
    if (!sum) return [] as { rank: 1 | 2 | 3; fixed: string | null; choices: string[] | null }[]
    const comp = computeSummary(sum.matrix, sum.publishers.map((p) => p.id), sum.members.map((m) => m.id), master.settings.averageDecimals)
    const ordered = [...sum.publishers].sort((a, b) => comp.ranks[a.id] - comp.ranks[b.id])
    return ([1, 2, 3] as const).map((r) => {
      const at = ordered[r - 1]
      if (!at) return { rank: r, fixed: null, choices: null }
      const group = ordered.filter((p) => comp.ranks[p.id] === comp.ranks[at.id])
      // 평균이 같은 출판사가 여럿이면 이 자리는 서류만 보고 정할 수 없다 → 그 출판사들 중에서 고르게 한다
      return group.length > 1 ? { rank: r, fixed: null, choices: group.map((p) => p.id) } : { rank: r, fixed: at.id, choices: null }
    })
  }, [sum, master.settings.averageDecimals])

  /**
   * 추천 의견서 순위를 총괄표 순위에 맞춘다 (의견서 단계에 들어올 때마다).
   * 출판사가 바뀐 순위의 의견 글은 다른 출판사 이야기이므로 비운다.
   */
  const syncRanks = () => {
    const cur = latest.current
    if (!cur) return
    const cleared: number[] = []
    const ties: number[] = []
    const recommendDoc = cur.recommendDoc.map((row) => {
      const slot = rankSlots.find((x) => x.rank === row.rank)
      let pubId: string | null = row.pubId
      if (!slot || (!slot.fixed && !slot.choices)) pubId = null
      else if (slot.fixed) pubId = slot.fixed
      else {
        ties.push(row.rank)
        if (!pubId || !slot.choices!.includes(pubId)) pubId = null
      }
      if (pubId !== row.pubId && row.text.trim()) cleared.push(row.rank)
      return pubId === row.pubId ? row : { ...row, pubId, text: pubId !== row.pubId ? '' : row.text }
    })
    if (recommendDoc.some((r, i) => r !== cur.recommendDoc[i])) update({ recommendDoc })
    const notes: string[] = []
    if (cleared.length) notes.push(`총괄표 순위가 바뀌어 ${cleared.join('·')}순위 의견을 비웠습니다.`)
    if (ties.length) notes.push(`평균이 같아 총괄표만으로는 ${ties.join('·')}순위를 정할 수 없습니다 — 노란 칸에서 출판사를 확인하거나 골라 주세요.`)
    setMsg(notes.length ? { type: 'warn', text: notes.join(' ') } : null)
  }

  /**
   * 동점 자리에서 출판사를 고른다.
   * 고른 곳이 같은 동점 무리의 다른 자리에 있으면 두 자리를 맞바꾸고,
   * 무리에 빈 자리가 하나만 남으면 남은 출판사를 채운다. 출판사가 바뀐 자리의 의견 글은 비운다.
   */
  const pickTie = (rank: number, pubId: string) => {
    update((prev) => {
      const slot = rankSlots.find((x) => x.rank === rank)
      const chosen = pubId || null
      const mine = prev.recommendDoc.find((r) => r.rank === rank)?.pubId || null
      const other = chosen ? prev.recommendDoc.find((r) => r.rank !== rank && r.pubId === chosen) : undefined
      const put = (r: SummaryRecommend, id: string | null) => (r.pubId === id ? r : { ...r, pubId: id, text: '' })
      let doc = prev.recommendDoc.map((r) => (r.rank === rank ? put(r, chosen) : other && r.rank === other.rank ? put(r, mine) : r))
      if (slot?.choices) {
        const group = rankSlots.filter((x) => x.choices && x.choices.join() === slot.choices!.join())
        const empty = group.filter((x) => !doc.find((r) => r.rank === x.rank)?.pubId)
        const left = slot.choices.filter((id) => !doc.some((r) => r.pubId === id))
        if (empty.length === 1 && left.length === 1) doc = doc.map((r) => (r.rank === empty[0].rank ? put(r, left[0]) : r))
      }
      return { recommendDoc: doc }
    })
  }

  /** 그 순위에서 고를 수 있는 출판사 (동점 자리만 — 같은 무리 전체, 고르면 맞바꾼다) */
  const pickable = (rank: number): string[] | null => rankSlots.find((x) => x.rank === rank)?.choices || null

  const goStep = (i: number) => {
    if (!sum) return
    if (i === 1) syncRanks()
    else setMsg(null)
    setStep(i)
  }

  /** 점수를 직접 넣어야 하는 칸 (그 위원 평가표에 이 출판사가 없을 때) */
  const missing = useMemo(() => {
    if (!sum) return [] as string[]
    const out: string[] = []
    for (const m of sum.members) {
      if (m.source === 'manual') continue
      const lost = sum.publishers.filter((p) => totalOf(m, p.name) === null).map((p) => p.name)
      if (lost.length) out.push(`${m.teacherName}: ${lost.join(', ')} 점수가 평가표에 없어 0으로 두었습니다. 표에서 고칠 수 있습니다.`)
    }
    return out
  }, [sum])

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
        sources={sources}
        avoid={sum.recommendDoc.filter((r) => r.rank !== item.rank && r.text).map((r) => r.text)}
        notice={pub ? undefined : '이 순위의 출판사를 먼저 표에서 고르면 문장을 생성할 수 있습니다.'}
        onCancel={() => setModalRank(null)}
        onApply={({ text }) => {
          update((prev) => ({
            recommendDoc: prev.recommendDoc.map((r) => (r.rank === item.rank ? { ...r, text } : r)),
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
              onClick={() => goStep(i)}
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

      <button className="btn sm side-toggle no-print" onClick={() => setSideOpen((v) => !v)}>
        {sideOpen ? '입력 칸 접기 ▲' : '입력 칸 열기 ▼'}
      </button>

      <div className="work-layout">
        {/* 왼쪽: 입력 사이드바 */}
        <aside className={`work-side no-print ${sideOpen ? '' : 'closed'}`}>
          <div className="card side-card">
            <h3>기본정보</h3>
            <div className="field">
              학교
              <div className="seg">
                <button
                  className={school === '중' ? 'on' : ''}
                  onClick={() => {
                    setSchool('중')
                    lsSet(SCHOOL_KEY, '중')
                  }}
                >
                  중학교
                </button>
                <button
                  className={school === '고' ? 'on' : ''}
                  onClick={() => {
                    setSchool('고')
                    lsSet(SCHOOL_KEY, '고')
                  }}
                >
                  고등학교
                </button>
              </div>
            </div>
            <div className="field">
              과목
              {master.subjects.length > 0 ? (
                <SubjectSearch
                  subjects={master.subjects}
                  value={subjectId}
                  school={school}
                  onChange={(id) => {
                    setSubjectId(id)
                    setSubjectName(master.subjects.find((s) => s.id === id)?.name || '')
                  }}
                />
              ) : (
                <input type="text" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="예: 세계사" />
              )}
            </div>
            {master.subjects.length > 0 && !subjectId && (
              <label className="field">
                목록에 없으면 직접 입력
                <input type="text" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="예: 세계사" />
              </label>
            )}

            <h3 style={{ marginTop: 16 }}>위원 평가표 ({members.length})</h3>
            <div
              className={`dropzone sm ${dragOver ? 'over' : ''} ${subjectReady ? '' : 'locked'}`}
              onDragOver={(e) => {
                e.preventDefault()
                if (subjectReady) setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                addFiles(e.dataTransfer.files)
              }}
            >
              {subjectReady ? (
                <>
                  <p>위원들이 보낸 평가표 PDF를 끌어다 놓거나</p>
                  <label className="btn primary sm">
                    + 추가하기
                    <input type="file" accept="application/pdf,.pdf" multiple style={{ display: 'none' }} onChange={(e) => addFiles(e.target.files)} />
                  </label>
                </>
              ) : (
                <>
                  <p>
                    <b>과목을 먼저 골라 주세요.</b>
                  </p>
                  <p className="muted">과목이 정해지면 여기에 위원 평가표 PDF를 올릴 수 있습니다.</p>
                </>
              )}
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
                <button className="btn sm" onClick={addManual} disabled={!subjectReady} title={subjectReady ? undefined : '과목을 먼저 골라 주세요'}>
                  위원 직접 추가
                </button>
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
          {!sum && (
            <div className="card empty-hint">
              <h2>평가 총괄표</h2>
              <p className="muted small">
                {subjectReady
                  ? '입력 칸의 [+ 추가하기]로 위원들이 보낸 선정 평가표 PDF를 올리세요. 올리는 대로 위원명·출판사·점수를 읽어 총괄표를 바로 만듭니다.'
                  : '먼저 학교와 과목을 고른 뒤, 위원들이 보낸 선정 평가표 PDF를 올리세요. 올리는 대로 총괄표가 만들어집니다.'}
              </p>
            </div>
          )}

          {sum && step === 0 && (
            <>
              <div className="card">
                <div className="main-head">
                  <h2>평가 총괄표</h2>
                  <span className="ai-note">{DRAFT_NOTE}</span>
                  <div className="main-head-actions">
                    <button className="btn" onClick={() => askPrint('form2')}>
                      <PrinterIcon /> 총괄표 인쇄 · PDF
                    </button>
                    <button className="btn primary" onClick={() => goStep(1)}>
                      다음: 추천 의견서
                    </button>
                  </div>
                </div>
                <p className="muted small">
                  위원 평가표를 더 올리거나 빼면 표가 바로 다시 만들어집니다. 칸을 클릭하면 점수를 고칠 수 있고, 고친 칸은 위원을 더 올려도 그대로 남습니다. 아래
                  작성자·확인자 칸은 인쇄한 뒤 손으로 적어 주세요.
                </p>
                {sum.members.length < 3 && (
                  <p className="alert warn small">위원이 {sum.members.length}명입니다. 계획서는 3인 이상을 권장합니다(소규모 학교는 2인 가능).</p>
                )}
                {(missing.length > 0 || sum.members.some((m) => m.warnings.length)) && (
                  <details className="check-list">
                    <summary>확인할 점 {missing.length + sum.members.filter((m) => m.warnings.length).length}건</summary>
                    <ul>
                      {sum.members
                        .filter((m) => m.warnings.length)
                        .map((m) => (
                          <li key={m.id}>
                            <b>{m.teacherName}</b>: {m.warnings.join(' ')}
                          </li>
                        ))}
                      {missing.map((t, i) => (
                        <li key={`miss-${i}`}>{t}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <p className="swipe-hint">표가 화면보다 넓으면 옆으로 밀어서 볼 수 있어요.</p>
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
                    sortByAverage={sortByAvg}
                    onCellChange={changeCell}
                  />
                </SheetFit>
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
            </>
          )}

          {sum && step === 1 && (
            <div className="card">
              <div className="main-head">
                <h2>추천 의견서</h2>
                <span className="ai-note">{DRAFT_NOTE}</span>
                <div className="main-head-actions">
                  <button className="btn" onClick={() => goStep(0)}>
                    이전
                  </button>
                  <button className="btn primary" onClick={() => askPrint('form3')}>
                    <PrinterIcon /> 추천 의견서 인쇄 · PDF
                  </button>
                  <button className="btn soft" onClick={saveHwpx}>
                    <HwpIcon /> 한글(hwpx) 저장
                  </button>
                  <button className="btn" onClick={exportJson}>
                    JSON 내보내기
                  </button>
                </div>
              </div>
              <p className="muted small">
                1~3순위 출판사는 <b>평가 총괄표의 평균 순위</b>로 정해집니다. 순위를 바꾸려면 [이전]에서 총괄표 점수를 고치세요. 의견 칸을 클릭하면 위원 의견을
                종합하는 창이 열립니다. [한글(hwpx) 저장]은 총괄표와 의견서를 한 파일로 받습니다. 작성자·확인자 칸은 인쇄한 뒤 손으로 적어 주세요.
              </p>
              <p className="swipe-hint">서식이 화면보다 넓으면 옆으로 밀어서 볼 수 있어요.</p>
              <SheetFit bottomGap={120}>
                <Form3Sheet
                  variant="official"
                  subjectName={sum.subjectName}
                  publishers={sum.publishers}
                  rows={sum.recommendDoc}
                  onTextChange={(rank, v) => update({ recommendDoc: sum.recommendDoc.map((r) => (r.rank === rank ? { ...r, text: v } : r)) })}
                  onPubChange={pickTie}
                  pickable={pickable}
                  onOpinionClick={(rank) => setModalRank(rank)}
                />
              </SheetFit>
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
          cancelLabel={notice.closeLabel || (notice.tone === 'info' ? '돌아가서 검토' : '닫기')}
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
