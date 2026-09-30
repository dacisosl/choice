import type { Person } from '../types'

export type SignRole = 'writer' | 'checker'

interface Props {
  /** 첫 줄 왼쪽에 붙는 머리글 (서식3의 '교과협의회') */
  lead?: string
  writer?: Person
  checker?: Person
  readOnly?: boolean
  /** 주면 직·성명 칸을 화면에서 바로 고칠 수 있다. 비우면 인쇄에서 빈칸(손으로 쓰는 자리) */
  onChange?: (role: SignRole, field: keyof Person, v: string) => void
}

const EMPTY: Person = { position: '', name: '' }

/** 서식 오른쪽 아래 서명란(작성자·확인자). 직·성명은 화면에서 바로 적거나, 비워 두고 손으로 쓴다 */
export function SignLines({ lead, writer = EMPTY, checker = EMPTY, readOnly, onChange }: Props) {
  const editable = !readOnly && !!onChange
  const cell = (role: SignRole, field: keyof Person, value: string) => {
    const cls = `fill ${field === 'name' ? 'name' : ''}`
    if (!editable) return <span className={cls}>{value}</span>
    return (
      <input
        className={`${cls} sign-edit`}
        type="text"
        value={value}
        placeholder={field === 'name' ? '성명' : '직위'}
        aria-label={`${role === 'writer' ? '작성자' : '확인자'} ${field === 'name' ? '성명' : '직'}`}
        maxLength={20}
        size={field === 'name' ? 8 : 6}
        onChange={(e) => onChange!(role, field, e.target.value)}
      />
    )
  }
  const line = (role: SignRole, who: Person, label: string, first: boolean) => (
    <div className="line">
      {lead !== undefined && (
        <span className="k" style={{ width: 80 }}>
          {first ? lead : ''}
        </span>
      )}
      <span className="k">{label}</span>
      <span>직 {cell(role, 'position', who.position || '')}</span>
      <span>성명 {cell(role, 'name', who.name || '')} (인)</span>
    </div>
  )
  return (
    <div className="sign-block">
      {line('writer', writer, '작성자', true)}
      {line('checker', checker, '확인자', false)}
    </div>
  )
}
