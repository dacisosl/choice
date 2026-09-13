import { useEffect, useRef, useState } from 'react'
import type { OpinionOption, RecommendStrength, Settings } from '../types'
import { aiGenerate, getApiKey, setApiKey, splitKeys } from '../lib/ai'
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
  /** 문서 누적 AI 생성 횟수 */
  aiCount: number
  /** compile: 종합할 위원 의견 */
  sources?: { teacherName: string; text: string }[]
  /** 같은 문서의 다른 순위 문장 — 표현이 겹치지 않게 */
  avoid?: string[]
  /** 출판사 미선택 등으로 생성할 수 없을 때 보여 줄 안내 */
  notice?: string
  onCancel: () => void
  onApply: (v: { text: string; keys: string[]; strength?: RecommendStrength; aiUsed: number }) => void
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
  aiCount,
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
  const [used, setUsed] = useState(0)
  const [showSources, setShowSources] = useState(false)
  // AI 키는 이 컴퓨터에만 저장된다. 쓰이는 자리에서 바로 넣고 지울 수 있게 둔다
  const [apiKey, setKeyState] = useState(() => getApiKey())
  const [editKey, setEditKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    areaRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const hasKey = !!apiKey
  const overLimit = aiCount + used >= settings.aiMaxPerDoc

  const generate = async () => {
    setBusy(true)
    setMsg(null)
    const { positives, negatives } = splitKeys(options, keys)
    const res = await aiGenerate(
      {
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
      },
      settings.aiModel,
      settings.aiFallbackModel,
    )
    setBusy(false)
    setText(res.text)
    if (res.source === 'ai') {
      setUsed((n) => n + 1)
      setMsg('AI가 문장을 생성했습니다. 내용을 확인·수정한 뒤 [적용]을 누르세요.')
    } else {
      setMsg(
        hasKey
          ? `규칙 기반 문장으로 생성했습니다${res.error && res.error !== 'API 키 없음' ? ` (AI 오류: ${res.error})` : ''}.`
          : '규칙 기반 문장으로 생성했습니다. 아래 [AI 키 넣기]에 OpenRouter 키를 넣으면 더 자연스러운 문장을 만들 수 있습니다.',
      )
    }
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
              <button
                className="linklike muted small"
                onClick={() => {
                  setKeyDraft('')
                  setEditKey((v) => !v)
                }}
                title="AI 키는 이 컴퓨터에만 저장됩니다"
              >
                {hasKey ? `AI ${settings.aiModel} · ${aiCount + used}/${settings.aiMaxPerDoc}회${overLimit ? ' (상한 도달)' : ''}` : 'AI 키 넣기 — 지금은 규칙 기반 문장'}
              </button>
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
              <button className="btn primary" onClick={generate} disabled={busy || !!notice}>
                {busy ? '생성 중…' : text ? '다시 생성' : '의견 생성'}
              </button>
            </div>
          </div>
          {editKey && (
            <div className="key-row">
              <input
                type="password"
                value={keyDraft}
                placeholder={hasKey ? '새 키를 넣으면 바꿉니다 (sk-or-…)' : 'OpenRouter 키 (sk-or-…)'}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !keyDraft.trim()) return
                  setApiKey(keyDraft.trim())
                  setKeyState(keyDraft.trim())
                  setEditKey(false)
                  setMsg('AI 키를 저장했습니다. 이제 [의견 생성]이 AI 문장을 만듭니다.')
                }}
              />
              <button
                className="btn"
                disabled={!keyDraft.trim()}
                onClick={() => {
                  setApiKey(keyDraft.trim())
                  setKeyState(keyDraft.trim())
                  setEditKey(false)
                  setMsg('AI 키를 저장했습니다. 이제 [의견 생성]이 AI 문장을 만듭니다.')
                }}
              >
                저장
              </button>
              {hasKey && (
                <button
                  className="btn danger"
                  onClick={() => {
                    setApiKey('')
                    setKeyState('')
                    setEditKey(false)
                    setMsg('AI 키를 지웠습니다. 규칙 기반 문장으로 생성합니다.')
                  }}
                >
                  키 지우기
                </button>
              )}
            </div>
          )}
          {editKey && (
            <p className="muted small" style={{ marginTop: 6 }}>
              키는 이 컴퓨터(브라우저)에만 저장되며 서버로 보내지 않습니다. 키가 없어도 규칙 기반 문장으로 초안이 만들어집니다.
            </p>
          )}
          {msg && <p className="muted small" style={{ marginTop: 6 }}>{msg}</p>}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>
            취소
          </button>
          <button className="btn primary" onClick={() => onApply({ text, keys, strength: kind === 'recommend' ? strength : undefined, aiUsed: used })}>
            적용
          </button>
        </div>
      </div>
    </div>
  )
}
