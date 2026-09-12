import type { DocPublisher, Person, SummaryMember } from '../types'
import { computeSummary, rankLabel } from '../lib/scoring'
import { NumberCell } from './EditableCell'

interface Props {
  subjectName: string
  publishers: DocPublisher[]
  members: Pick<SummaryMember, 'id' | 'teacherName'>[]
  matrix: Record<string, Record<string, number>>
  headerMode: 'name' | 'number'
  decimals: number
  writer: Person
  checker: Person
  readOnly?: boolean
  sortByAverage?: boolean
  onCellChange?: (pubId: string, memberId: string, v: number) => void
}

/** 【서식2】 검정(인정)도서 선정기준 평가 총괄표 — A4 세로 */
export function Form2Sheet({ subjectName, publishers, members, matrix, headerMode, decimals, writer, checker, readOnly, sortByAverage, onCellChange }: Props) {
  const memberIds = members.map((m) => m.id)
  const pubIds = publishers.map((p) => p.id)
  const computed = computeSummary(matrix, pubIds, memberIds, decimals)
  const rows = sortByAverage ? [...publishers].sort((a, b) => computed.averages[b.id] - computed.averages[a.id]) : publishers
  const M = members.length

  return (
    <div className={`form-sheet ${readOnly ? 'readonly' : ''}`}>
      <div className="form-tag">【서식2】</div>
      <div className="form-title">검정(인정)도서 선정기준 평가 총괄표</div>
      <div className="form-head">
        <div>
          과&nbsp;&nbsp;목 : <span className="name">{subjectName || '________'}</span>
        </div>
        <div />
      </div>
      <table className="form">
        <colgroup>
          <col style={{ width: 110 }} />
          {members.map((m) => (
            <col key={m.id} />
          ))}
          {M === 0 && <col />}
          <col style={{ width: 62 }} />
          <col style={{ width: 62 }} />
          <col style={{ width: 84 }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>출판사명</th>
            <th colSpan={Math.max(M, 1)}>위&nbsp;&nbsp;원&nbsp;&nbsp;별&nbsp;&nbsp;점&nbsp;&nbsp;수</th>
            <th rowSpan={2}>총점</th>
            <th rowSpan={2}>평균</th>
            <th rowSpan={2}>비고</th>
          </tr>
          <tr>
            {members.map((m, i) => (
              <th key={m.id} style={{ fontSize: '9.5pt' }}>
                {headerMode === 'name' ? m.teacherName : `위원${i + 1}`}
              </th>
            ))}
            {M === 0 && <th>위원 없음</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="c">{p.name}</td>
              {members.map((m) => (
                <NumberCell
                  key={m.id}
                  value={Number(matrix[p.id]?.[m.id]) || 0}
                  readOnly={readOnly}
                  onChange={(v) => onCellChange?.(p.id, m.id, v)}
                />
              ))}
              {M === 0 && <td />}
              <td className="c">{computed.totals[p.id]}</td>
              <td className="c">{M ? computed.averages[p.id].toFixed(decimals) : ''}</td>
              <td className="c">{M ? rankLabel(computed.ranks[p.id], computed.tieCounts[computed.ranks[p.id]]) : ''}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4 + Math.max(M, 1)} className="c muted">
                출판사 미등록
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="sign-block">
        <div className="line">
          <span className="k">작성자</span>
          <span>직 {writer.position || '______'}</span>
          <span>성명 {writer.name || '______'} (인)</span>
        </div>
        <div className="line">
          <span className="k">확인자</span>
          <span>직 {checker.position || '______'}</span>
          <span>성명 {checker.name || '______'} (인)</span>
        </div>
      </div>
      <div className="footnote">※ 작성자는 교과협의회 소속교사, 확인자는 교과협의회 대표교사로 함</div>
    </div>
  )
}
