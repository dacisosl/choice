import type { DocPublisher, Person } from '../types'
import { TextCell } from './EditableCell'

export interface Form3Row {
  rank: 1 | 2 | 3
  pubId: string | null
  text: string
}

interface Props {
  subjectName: string
  publishers: DocPublisher[]
  rows: Form3Row[]
  writer: Person
  checker: Person
  /** personal: 위원 개인용(위원명 표기), official: 대표교사 작성 공식본 */
  variant: 'personal' | 'official'
  teacherName?: string
  readOnly?: boolean
  onTextChange?: (rank: number, v: string) => void
  onPubChange?: (rank: number, pubId: string) => void
  /** 주면 추천의견 칸 클릭 시 의견 작성 창을 연다 */
  onOpinionClick?: (rank: number) => void
}

/** 【서식3】 추천 검정(인정)도서 및 추천 의견서 — A4 세로 */
export function Form3Sheet({ subjectName, publishers, rows, writer, checker, variant, teacherName, readOnly, onTextChange, onPubChange, onOpinionClick }: Props) {
  const pubName = (id: string | null) => publishers.find((p) => p.id === id)?.name || ''
  return (
    <div className={`form-sheet ${readOnly ? 'readonly' : ''}`}>
      <div className="form-title">추천 검정(인정)도서 및 추천 의견서</div>
      <div className="form-head">
        <div>
          과&nbsp;&nbsp;목 : <span className="name">{subjectName}</span>
        </div>
        {variant === 'personal' && (
          <div className="right">
            위&nbsp;&nbsp;원 : <span className="name">{teacherName}</span> (인)
          </div>
        )}
      </div>
      <table className="form">
        <colgroup>
          <col style={{ width: 52 }} />
          <col style={{ width: 120 }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>순위</th>
            <th>출판사명</th>
            <th>추&nbsp;&nbsp;천&nbsp;&nbsp;의&nbsp;&nbsp;견</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rank}>
              <td className="c">{r.rank}</td>
              <td className="c">
                {readOnly || !onPubChange ? (
                  pubName(r.pubId)
                ) : (
                  <select
                    value={r.pubId || ''}
                    onChange={(e) => onPubChange(r.rank, e.target.value)}
                    style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'center', fontFamily: 'inherit', fontSize: 'inherit' }}
                  >
                    <option value="">-</option>
                    {publishers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <TextCell
                className="opinion tall"
                value={r.text}
                readOnly={readOnly}
                onChange={(v) => onTextChange?.(r.rank, v)}
                onOpen={onOpinionClick ? () => onOpinionClick(r.rank) : undefined}
                openHint="클릭하여 추천의견 작성"
                placeholder="클릭하여 추천의견을 작성하세요"
              />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sign-block">
        <div className="line">
          <span className="k" style={{ width: 80 }}>
            교과협의회
          </span>
          <span className="k">작성자</span>
          <span>직 <span className="fill">{writer.position}</span></span>
          <span>성명 <span className="fill">{writer.name}</span> (인)</span>
        </div>
        <div className="line">
          <span className="k" style={{ width: 80 }} />
          <span className="k">확인자</span>
          <span>직 <span className="fill">{checker.position}</span></span>
          <span>성명 <span className="fill">{checker.name}</span> (인)</span>
        </div>
      </div>
      <div className="footnote">
        {variant === 'official'
          ? '※ 작성자는 교과협의회 대표교사, 확인자는 교감으로 함'
          : '※ 위원 개인 추천의견 — 교과협의회 총괄 시 참고 자료'}
      </div>
    </div>
  )
}
