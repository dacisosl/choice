import { useState } from 'react'
import type { Criterion, DocPublisher } from '../types'
import { columnTotal } from '../lib/scoring'
import { NumberCell, TextCell } from './EditableCell'

interface Props {
  subjectName: string
  teacherName: string
  criteria: Criterion[]
  publishers: DocPublisher[]
  scores: Record<string, Record<string, number>>
  opinion: string
  readOnly?: boolean
  onScoreChange?: (pubId: string, critId: string, v: number) => void
  onOpinionChange?: (v: string) => void
  /** 주면 종합의견 칸 클릭 시 의견 작성 창을 연다 */
  onOpinionClick?: () => void
}

/** 【서식1】 검정(인정)도서 선정 평가표 — A4 가로 */
export function Form1Sheet({ subjectName, teacherName, criteria, publishers, scores, opinion, readOnly, onScoreChange, onOpinionChange, onOpinionClick }: Props) {
  const N = publishers.length
  const totalPoints = criteria.reduce((s, c) => s + c.points, 0)

  // 같은 평가영역 세로 병합
  const areaSpans: Record<number, number> = {}
  for (let i = 0; i < criteria.length; ) {
    let j = i
    while (j < criteria.length && criteria[j].area === criteria[i].area) j++
    areaSpans[i] = j - i
    i = j
  }

  const pubColWidth = N ? Math.max(48, Math.floor(520 / N)) : 60
  /** 지금 고치는 중인 점수 칸 (합계 미리 보기용) */
  const [draft, setDraft] = useState<{ pubId: string; critId: string; value: number } | null>(null)

  return (
    <div className={`form-sheet form1 landscape ${readOnly ? 'readonly' : ''}`}>
      <div className="form-title">검정(인정)도서 선정 평가표</div>
      <div className="form-head">
        <div />
        <div className="right">
          <span className="sign">
            과&nbsp;&nbsp;목 : <span className="name">{subjectName}</span> 과
          </span>
          &nbsp;&nbsp;&nbsp;&nbsp;
          <span className="sign">
            위&nbsp;&nbsp;원 : <span className="name">{teacherName}</span> (인)
          </span>
        </div>
      </div>
      <table className="form">
        <colgroup>
          <col style={{ width: 90 }} />
          <col />
          <col style={{ width: 62 }} />
          {publishers.map((p) => (
            <col key={p.id} style={{ width: pubColWidth }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>평가영역</th>
            <th rowSpan={2} className="diag" style={{ height: 52 }}>
              <span className="a">출판사</span>
              <span className="b">평가기준</span>
            </th>
            <th rowSpan={2}>
              항목별
              <br />
              점수
            </th>
            {publishers.map((_, i) => (
              <th key={i}>{i + 1}</th>
            ))}
            {N === 0 && <th>-</th>}
          </tr>
          <tr>
            {publishers.map((p) => (
              <th key={p.id} style={{ fontSize: '9.5pt' }}>
                {p.name}
              </th>
            ))}
            {N === 0 && <th>출판사 미등록</th>}
          </tr>
        </thead>
        <tbody>
          {criteria.map((c, i) => (
            <tr key={c.id}>
              {areaSpans[i] !== undefined && (
                <td rowSpan={areaSpans[i]} className="c">
                  {c.area}
                </td>
              )}
              <td>{c.text}</td>
              <td className="c">{c.points}</td>
              {publishers.map((p) => (
                <NumberCell
                  key={p.id}
                  value={Number(scores[p.id]?.[c.id]) || 0}
                  max={c.points}
                  readOnly={readOnly}
                  onChange={(v) => onScoreChange?.(p.id, c.id, v)}
                  onDraft={(v) => setDraft(v === null ? null : { pubId: p.id, critId: c.id, value: v })}
                />
              ))}
              {N === 0 && <td />}
            </tr>
          ))}
          <tr>
            <th colSpan={2}>합&nbsp;&nbsp;계</th>
            <td className="c" style={{ fontWeight: 600 }}>
              {totalPoints}
            </td>
            {publishers.map((p) => {
              const total = columnTotal(scores[p.id], criteria)
              // 어느 칸을 고치는 중이면 그 값을 넣은 합계를 미리 보여 준다 (확정되면 원래 계산으로 돌아간다)
              const pending = draft && draft.pubId === p.id
              const shown = pending ? total - (Number(scores[p.id]?.[draft.critId]) || 0) + draft.value : total
              return (
                <td key={p.id} className={`c ${pending ? 'pending' : ''}`} style={{ fontWeight: 600 }}>
                  {shown}
                </td>
              )
            })}
            {N === 0 && <td />}
          </tr>
          <tr>
            <th colSpan={3 + Math.max(N, 1)} style={{ background: '#fff', fontWeight: 600 }}>
              &lt;종합의견 및 추천의견&gt;
            </th>
          </tr>
          <tr>
            <TextCell
              colSpan={3 + Math.max(N, 1)}
              className="opinion"
              value={opinion}
              readOnly={readOnly}
              onChange={(v) => onOpinionChange?.(v)}
              onOpen={onOpinionClick}
              openHint="클릭하여 종합의견 작성"
              placeholder="클릭하여 종합의견을 작성하세요"
            />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
