import type { OpinionOption } from '../types'

interface Props {
  options: OpinionOption[]
  scope: 'summary' | 'recommend'
  subjectGroup: string
  selected: string[]
  onChange: (keys: string[]) => void
  disabled?: boolean
}

export function OpinionPicker({ options, scope, subjectGroup, selected, onChange, disabled }: Props) {
  const list = options
    .filter((o) => o.scope === scope && (o.subjectGroup === null || o.subjectGroup === subjectGroup))
    .sort((a, b) => a.order - b.order)
  const cats = Array.from(new Set(list.map((o) => o.category)))
  const toggle = (id: string) => {
    if (disabled) return
    onChange(selected.includes(id) ? selected.filter((k) => k !== id) : [...selected, id])
  }
  return (
    <div className="opt-groups">
      {cats.map((cat) => (
        <div className="opt-group" key={cat}>
          <h4>{cat}</h4>
          {list
            .filter((o) => o.category === cat)
            .map((o) => (
              <label key={o.id} className={o.negative ? 'neg' : ''}>
                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} disabled={disabled} />
                <span>{o.label}</span>
              </label>
            ))}
        </div>
      ))}
    </div>
  )
}
