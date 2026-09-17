import { useEffect, useRef, useState } from 'react'

interface NumProps {
  value: number
  max?: number
  min?: number
  readOnly?: boolean
  onChange: (v: number) => void
  /** 입력 중인 값(확정 전). 합계를 미리 보여 주는 데 쓴다. 편집이 끝나면 null */
  onDraft?: (v: number | null) => void
  className?: string
}

/** 숫자 셀: 클릭 → 입력 컴포넌트로 교체. 값은 Enter 나 포커스 이동으로 확정된다 */
export function NumberCell({ value, max, min = 0, readOnly, onChange, onDraft, className }: NumProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const ref = useRef<HTMLInputElement>(null)
  // 고치기 시작할 때 지금 값을 담아 두고(아래 onClick), 여기서는 커서만 옮긴다.
  // 예전에는 value 가 바뀔 때마다 입력칸을 되돌려, 빨리 친 숫자가 옛 값으로 덮이는 일이 있었다.
  useEffect(() => {
    if (!editing) return
    ref.current?.focus()
    ref.current?.select()
  }, [editing])
  const over = max !== undefined && value > max
  const stop = () => {
    setEditing(false)
    onDraft?.(null)
  }
  const commit = () => {
    const n = Number(draft)
    if (draft.trim() !== '' && !Number.isNaN(n)) onChange(Math.max(min, n))
    stop()
  }
  return (
    <td
      className={`num editable ${over ? 'over' : ''} ${className || ''}`}
      onClick={() => {
        if (readOnly || editing) return
        setDraft(String(value))
        setEditing(true)
      }}
      title={over ? `배점(${max}) 초과` : undefined}
    >
      {editing ? (
        <input
          ref={ref}
          className="cell-edit"
          type="number"
          value={draft}
          min={min}
          onChange={(e) => {
            setDraft(e.target.value)
            // 화살표 단추·마우스 휠·직접 입력 모두 합계에 바로 비쳐 보이게 알린다
            const n = Number(e.target.value)
            onDraft?.(e.target.value.trim() === '' || Number.isNaN(n) ? null : Math.max(min, n))
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') stop()
          }}
        />
      ) : (
        value
      )}
    </td>
  )
}

interface TextProps {
  value: string
  readOnly?: boolean
  onChange: (v: string) => void
  className?: string
  placeholder?: string
  colSpan?: number
  rowSpan?: number
  /** 주면 인라인 편집 대신 이 함수를 부른다 (의견 작성 창 열기) */
  onOpen?: () => void
  /** onOpen 이 있을 때 빈 칸에 보여 줄 안내 */
  openHint?: string
}

/** 텍스트 셀: 클릭 → 자동 높이 textarea (onOpen 이 있으면 창 열기) */
export function TextCell({ value, readOnly, onChange, className, placeholder, colSpan, rowSpan, onOpen, openHint }: TextProps) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus()
      ref.current.style.height = 'auto'
      ref.current.style.height = ref.current.scrollHeight + 'px'
    }
  }, [editing])
  return (
    <td
      className={`editable ${className || ''}`}
      colSpan={colSpan}
      rowSpan={rowSpan}
      onClick={() => {
        if (readOnly) return
        if (onOpen) return onOpen()
        if (!editing) setEditing(true)
      }}
      title={!readOnly && onOpen ? (openHint || '클릭하여 의견 작성') : undefined}
    >
      {editing ? (
        <textarea
          ref={ref}
          className="cell-edit text"
          value={value}
          rows={3}
          onChange={(e) => {
            onChange(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
          }}
          onBlur={() => setEditing(false)}
        />
      ) : value ? (
        value
      ) : (
        <span className="muted no-print" style={{ fontFamily: 'Malgun Gothic, sans-serif', fontSize: 12 }}>
          {readOnly ? '' : onOpen ? openHint || '클릭하여 의견 작성' : placeholder || '클릭하여 입력'}
        </span>
      )}
    </td>
  )
}
