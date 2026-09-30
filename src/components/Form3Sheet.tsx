import type { DocPublisher, Person } from '../types'
import { TextCell } from './EditableCell'
import { SignLines, type SignRole } from './SignLines'

export interface Form3Row {
  rank: 1 | 2 | 3
  pubId: string | null
  text: string
}

interface Props {
  subjectName: string
  publishers: DocPublisher[]
  rows: Form3Row[]
  /** 서명란 직·성명. 비우면 인쇄에서 빈칸(손으로 쓰는 자리) */
  writer?: Person
  checker?: Person
  /** 주면 서명란을 화면에서 바로 고칠 수 있다 */
  onSignChange?: (role: SignRole, field: keyof Person, v: string) => void
  /** personal: 위원 개인용(위원명 표기), official: 대표교사 작성 공식본 */
  variant: 'personal' | 'official'
  teacherName?: string
  readOnly?: boolean
  onTextChange?: (rank: number, v: string) => void
  onPubChange?: (rank: number, pubId: string) => void
  /**
   * 순위마다 고를 수 있는 출판사 id 목록. 주면 목록이 있는 순위만 고르는 칸이 되고
   * (총괄표에서 평균이 같아 순위를 가를 수 없는 경우), 나머지는 이름만 글자로 보인다.
   */
  pickable?: (rank: number) => string[] | null
  /** 주면 추천의견 칸 클릭 시 의견 작성 창을 연다 */
  onOpinionClick?: (rank: number) => void
}

/** 【서식3】 추천 검정(인정)도서 및 추천 의견서 — A4 세로 */
export function Form3Sheet({ subjectName, publishers, rows, variant, teacherName, writer, checker, onSignChange, readOnly, onTextChange, onPubChange, pickable, onOpinionClick }: Props) {
  const pubName = (id: string | null) => publishers.find((p) => p.id === id)?.name || ''
  return (
    <div className={`form-sheet form3 ${readOnly ? 'readonly' : ''}`}>
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
          <col style={{ width: 136 }} />
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
              <td className={`c pub-cell ${pickable?.(r.rank) ? 'tie' : ''}`}>
                {readOnly || !onPubChange || (pickable && !pickable(r.rank)) ? (
                  pubName(r.pubId)
                ) : (
                  <>
                    {/* 고르는 칸은 이름이 길면 잘려 인쇄된다. 인쇄할 때는 아래 글자만 나온다 */}
                    <span className="pub-print">{pubName(r.pubId)}</span>
                    <select className="pub-pick" value={r.pubId || ''} onChange={(e) => onPubChange(r.rank, e.target.value)}>
                      <option value="">{pickable ? '동점 — 고르기' : '-'}</option>
                      {publishers.filter((p) => !pickable || pickable(r.rank)?.includes(p.id)).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </>
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
      <SignLines lead="교과협의회" writer={writer} checker={checker} readOnly={readOnly} onChange={onSignChange} />
      <div className="footnote">
        {variant === 'official'
          ? '※ 작성자는 교과협의회 대표교사, 확인자는 교감으로 함'
          : '※ 위원 개인 추천의견 — 교과협의회 총괄 시 참고 자료'}
      </div>
    </div>
  )
}
