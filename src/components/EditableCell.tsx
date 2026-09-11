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
}

/** 텍스트 셀: 클릭 → 자동 높이 textarea */
export function TextCell({ value, readOnly, onChange, className, placeholder, colSpan, rowSpan }: TextProps) {
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
      onClick={() => !readOnly && !editing && setEditing(true)}
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
          {readOnly ? '' : placeholder || '클릭하여 입력'}
        </span>
      )}
    </td>
  )
}
