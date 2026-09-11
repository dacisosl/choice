import { useMemo, useState } from 'react'
import type { Subject } from '../types'

interface Props {
  subjects: Subject[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}

/** 검색형 과목 선택 */
export function SubjectSelect({ subjects, value, onChange, disabled }: Props) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim()
    const list = s ? subjects.filter((x) => `${x.subjectGroup} ${x.name}`.includes(s)) : subjects
    return list
  }, [subjects, q])
  const groups = Array.from(new Set(filtered.map((s) => `${s.gradeGroup}학년 ${s.subjectGroup}`)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input
        type="text"
        placeholder="과목 검색 (예: 수학, 세계사)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={disabled}
      />
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} size={1}>
        <option value="">과목 선택</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {filtered
              .filter((s) => `${s.gradeGroup}학년 ${s.subjectGroup}` === g)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.status === 'closed' ? ' (마감)' : ''}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
