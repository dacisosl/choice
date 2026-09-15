import { useState } from 'react'
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
  /** 지금 고치는 중인 점수 칸 (총점·평균·순위 미리 보기용) */
  const [draft, setDraft] = useState<{ pubId: string; memberId: string; value: number } | null>(null)
  const saved = computeSummary(matrix, pubIds, memberIds, decimals)
  // 고치는 중인 값을 넣어 다시 계산해 보여 준다. 줄 순서는 저장된 값 기준으로 두어 입력 중에 줄이 뛰지 않게 한다
  const computed = draft
    ? computeSummary({ ...matrix, [draft.pubId]: { ...(matrix[draft.pubId] || {}), [draft.memberId]: draft.value } }, pubIds, memberIds, decimals)
    : saved
  const rows = sortByAverage ? [...publishers].sort((a, b) => saved.averages[b.id] - saved.averages[a.id]) : publishers
  const M = members.length

  return (
    <div className={`form-sheet form2 ${readOnly ? 'readonly' : ''}`}>
      <div className="form-title">검정(인정)도서 선정기준 평가 총괄표</div>
      <div className="form-head">
        <div>
          과&nbsp;&nbsp;목 : <span className="name">{subjectName}</span>
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
                  onDraft={(v) => setDraft(v === null ? null : { pubId: p.id, memberId: m.id, value: v })}
                />
              ))}
              {M === 0 && <td />}
              <td className={`c ${draft && draft.pubId === p.id ? 'pending' : ''}`}>{computed.totals[p.id]}</td>
              <td className={`c ${draft && draft.pubId === p.id ? 'pending' : ''}`}>{M ? computed.averages[p.id].toFixed(decimals) : ''}</td>
              <td className={`c ${draft ? 'pending' : ''}`}>{M ? rankLabel(computed.ranks[p.id], computed.tieCounts[computed.ranks[p.id]]) : ''}</td>
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
          <span>직 <span className="fill">{writer.position}</span></span>
          <span>성명 <span className="fill">{writer.name}</span> (인)</span>
        </div>
        <div className="line">
          <span className="k">확인자</span>
          <span>직 <span className="fill">{checker.position}</span></span>
          <span>성명 <span className="fill">{checker.name}</span> (인)</span>
        </div>
      </div>
      <div className="footnote">※ 작성자는 교과협의회 소속교사, 확인자는 교과협의회 대표교사로 함</div>
    </div>
  )
}
