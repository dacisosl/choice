import { useEffect, useRef, useState } from 'react'

interface NumProps {
  value: number
  max?: number
  min?: number
  readOnly?: boolean
  onChange: (v: number) => void
  className?: string
}

/** 숫자 셀: 클릭 → 입력 컴포넌트로 교체 */
export function NumberCell({ value, max, min = 0, readOnly, onChange, className }: NumProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) {
      setDraft(String(value))
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing, value])
  const over = max !== undefined && value > max
  const commit = () => {
    const n = Number(draft)
    if (!Number.isNaN(n)) onChange(Math.max(min, n))
    setEditing(false)
  }
  return (
    <td
      className={`num editable ${over ? 'over' : ''} ${className || ''}`}
      onClick={() => !readOnly && !editing && setEditing(true)}
      title={over ? `배점(${max}) 초과` : undefined}
    >
      {editing ? (
        <input
          ref={ref}
          className="cell-edit"
          type="number"
          value={draft}
          min={min}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
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
