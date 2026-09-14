import { useEffect, useRef, useState } from 'react'
import type { OpinionOption, RecommendStrength, Settings } from '../types'
import { generateOpinion, splitKeys } from '../lib/opinionText'
import { OpinionPicker } from './OpinionPicker'

const STRENGTHS: RecommendStrength[] = ['적극 추천', '추천', '대안으로 추천']

export interface OpinionModalProps {
  title: string
  /** 선택지 묶음 (서식1 종합의견 / 서식3 추천의견) */
  scope: 'summary' | 'recommend'
  /** 문장 생성 방식 (compile = 위원 의견 종합) */
  kind: 'summary' | 'recommend' | 'compile'
  subjectName: string
  subjectGroup: string
  publisherName?: string
  rank?: number
  options: OpinionOption[]
  settings: Settings
  initialKeys: string[]
  initialText: string
  initialStrength?: RecommendStrength
  /** compile: 종합할 위원 의견 */
  sources?: { teacherName: string; text: string }[]
  /** 같은 문서의 다른 순위 문장 — 표현이 겹치지 않게 */
  avoid?: string[]
  /** 출판사 미선택 등으로 생성할 수 없을 때 보여 줄 안내 */
  notice?: string
  onCancel: () => void
  onApply: (v: { text: string; keys: string[]; strength?: RecommendStrength }) => void
}

/** 서식의 의견 칸을 클릭하면 열리는 창. 핵심의견 선택 → 문장 생성 → 수정 → 적용을 한 자리에서 한다 */
export function OpinionModal({
  title,
  scope,
  kind,
  subjectName,
  subjectGroup,
  publisherName,
  rank,
  options,
  settings,
  initialKeys,
  initialText,
  initialStrength,
  sources,
  avoid,
  notice,
  onCancel,
  onApply,
}: OpinionModalProps) {
  const [keys, setKeys] = useState<string[]>(initialKeys)
  const [text, setText] = useState(initialText)
  const [strength, setStrength] = useState<RecommendStrength>(initialStrength || '추천')
  const [length, setLength] = useState<'short' | 'long'>(kind === 'compile' ? 'long' : 'short')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [showSources, setShowSources] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    areaRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const generate = () => {
    setBusy(true)
    setMsg(null)
    const { positives, negatives } = splitKeys(options, keys)
    const next = generateOpinion({
      kind,
      subject: subjectName,
      publisher: publisherName,
      rank,
      positives,
      negatives,
      strength: kind === 'recommend' ? strength : undefined,
      tone: settings.tone,
      length,
      avoid,
      sources: sources?.map((s) => s.text),
    })
    setBusy(false)
    setText(next)
    setMsg('문장을 만들었습니다. 내용을 확인·수정한 뒤 [적용]을 누르세요.')
    window.setTimeout(() => {
      const el = areaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }, 0)
  }

  return (
    <div className="modal-backdrop no-print" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn sm ghost" onClick={onCancel} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {notice && <div className="alert warn" style={{ marginTop: 0 }}>{notice}</div>}

          {kind === 'compile' && sources && sources.length > 0 && (
            <div className="src-box">
              <button className="btn sm ghost" onClick={() => setShowSources((v) => !v)}>
                {showSources ? '▾' : '▸'} 참고할 위원 의견 {sources.length}건
              </button>
              {showSources && (
                <ul>
                  {sources.map((s, i) => (
                    <li key={i}>
                      <b>{s.teacherName}</b> {s.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {kind === 'compile' && (!sources || sources.length === 0) && (
            <p className="muted small">이 출판사에 대한 위원 개인 의견이 없어 아래 핵심의견만으로 문장을 만듭니다.</p>
          )}

          <h4 className="modal-sub">핵심의견 선택</h4>
          <OpinionPicker options={options} scope={scope} subjectGroup={subjectGroup} selected={keys} onChange={setKeys} />

          <h4 className="modal-sub">의견 문장 (직접 고칠 수 있습니다)</h4>
          <div className="modal-write">
            <textarea
              ref={areaRef}
              className="modal-text"
              value={text}
              rows={5}
              placeholder="핵심의견을 고르고 [의견 생성]을 누르거나 여기에 직접 입력하세요."
              onChange={(e) => setText(e.target.value)}
            />
            <div className="modal-gen">
              <select value={length} onChange={(e) => setLength(e.target.value as 'short' | 'long')}>
                <option value="short">2~4문장</option>
                <option value="long">4~6문장</option>
              </select>
              {kind === 'recommend' && (
                <select value={strength} onChange={(e) => setStrength(e.target.value as RecommendStrength)}>
                  {STRENGTHS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
              <button className="btn accent" onClick={generate} disabled={busy || !!notice}>
                {busy ? '생성 중…' : text ? '다시 생성' : '의견 생성'}
              </button>
            </div>
          </div>
          {msg && <p className="muted small" style={{ marginTop: 6 }}>{msg}</p>}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>
            취소
          </button>
          <button className="btn primary" onClick={() => onApply({ text, keys, strength: kind === 'recommend' ? strength : undefined })}>
            적용
          </button>
        </div>
      </div>
    </div>
  )
}
