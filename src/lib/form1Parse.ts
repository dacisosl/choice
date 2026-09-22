/**
 * 서식1(선정 평가표)·서식3(개인 추천의견) PDF에서 읽어 낸 글자 조각을 표로 되돌린다.
 *
 * 브라우저가 만든 PDF는 한글을 글자 하나씩 따로 저장하기 때문에
 *  ① y가 비슷한 조각을 한 줄로 묶고
 *  ② 줄 안에서 가까운 글자끼리 이어 붙여 '칸'으로 만든 뒤
 *  ③ '합계' 줄의 숫자 위치를 기준으로 열을 찾는다.
 * PDF 텍스트 레이어든 OCR 결과든 아래 TextItem 목록으로 바꿔 넣으면 같은 규칙으로 해석한다.
 * 좌표는 PDF 기준(왼쪽 아래가 원점, y가 위로 증가)을 쓴다.
 */
export interface TextItem {
  x: number
  y: number
  /** 글자 폭 (칸을 묶고 열 중심을 잡는 데 쓴다) */
  w?: number
  str: string
}

/** 칸을 이루는 글자 조각 하나 (PDF 가 내보낸 단위) */
export interface CellPart {
  x: number
  endX: number
  text: string
  /** 앞 조각과 사이에 띄어쓰기가 있었는가 */
  spaced: boolean
}

/** 줄 안에서 이어 붙인 한 덩어리 (표의 한 칸에 해당) */
export interface Cell {
  x: number
  endX: number
  center: number
  text: string
  /** 칸을 이루는 조각들 — 열이 좁아 이웃 칸과 붙어 버렸을 때 다시 나누는 데 쓴다 */
  parts: CellPart[]
}

export interface TextRow {
  y: number
  cells: Cell[]
  /** 칸을 공백으로 이은 줄 전체 글자 */
  text: string
  /** 공백을 모두 없앤 글자 (글자가 쪼개져 있어도 비교할 수 있게) */
  flat: string
}

export interface ParsedCriterion {
  area: string
  text: string
  points: number
}

export interface ParsedRecommend {
  rank: number
  publisherName: string
  text: string
}

export interface ParsedForm1 {
  subjectName: string
  teacherName: string
  publisherNames: string[]
  /** 출판사별 합계 점수 */
  totals: number[]
  criteria: ParsedCriterion[]
  /** [평가기준][출판사] 점수 */
  scores: number[][]
  summaryOpinion: string
  warnings: string[]
}

const NBSP = /[   ]/g

export function normalize(s: string): string {
  return s.replace(NBSP, ' ').replace(/\s+/g, ' ').trim()
}
export const flatten = (s: string) => normalize(s).replace(/\s/g, '')

const isNumber = (s: string) => /^-?\d+(\.\d+)?$/.test(flatten(s))

function median(values: number[]): number {
  if (!values.length) return 0
  const a = [...values].sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)]
}

/**
 * y가 비슷한 조각끼리 한 줄로 묶고, 줄 안에서 가까운 글자끼리 한 칸으로 잇는다.
 * @param yTolerance 같은 줄로 볼 y 차이
 */
export function buildRows(items: TextItem[], yTolerance = 3): TextRow[] {
  // 띄어쓰기 조각(폭이 있는 공백)은 낱말을 붙이지 않도록 살려 둔다
  const isSpace = (s: string) => s !== '' && s.trim() === ''
  const kept = items.filter((i) => normalize(i.str) !== '' || (isSpace(i.str) && (i.w || 0) > 0))
  if (!kept.length) return []

  // 칸 사이 간격 기준: 글자 하나 너비의 1.5배
  const charWidths = kept.filter((i) => normalize(i.str) !== '').map((i) => (i.w || 0) / Math.max(1, normalize(i.str).length)).filter((w) => w > 0)
  const gapLimit = Math.max(2, median(charWidths) * 1.5)

  const groups: { y: number; items: TextItem[] }[] = []
  for (const it of [...kept].sort((a, b) => b.y - a.y)) {
    const g = groups.find((r) => Math.abs(r.y - it.y) <= yTolerance)
    if (g) {
      g.items.push(it)
      g.y = (g.y * (g.items.length - 1) + it.y) / g.items.length
    } else groups.push({ y: it.y, items: [it] })
  }

  const rows: TextRow[] = groups.map(({ y, items: its }) => {
    const sorted = [...its].sort((a, b) => a.x - b.x)
    const cells: Cell[] = []
    // 띄어쓰기 조각은 칸의 폭에 넣지 않는다 (넣으면 열 사이가 이어져 한 칸이 된다).
    // 대신 '여기에 띄어쓰기가 있었다'만 기억해 두었다가 글자를 이을 때 공백을 넣는다.
    let pendingSpace = false
    for (const it of sorted) {
      if (isSpace(it.str)) {
        pendingSpace = true
        continue
      }
      const str = normalize(it.str)
      const end = it.x + (it.w || 0)
      const last = cells[cells.length - 1]
      if (last && it.x - last.endX <= gapLimit) {
        const spaced = pendingSpace || it.x - last.endX > gapLimit / 2
        last.text += (spaced ? ' ' : '') + str
        last.endX = Math.max(last.endX, end)
        last.parts.push({ x: it.x, endX: end, text: str, spaced })
      } else {
        cells.push({ x: it.x, endX: end, center: (it.x + end) / 2, text: str, parts: [{ x: it.x, endX: end, text: str, spaced: false }] })
      }
      pendingSpace = false
    }
    for (const c of cells) {
      c.text = normalize(c.text)
      c.center = (c.x + c.endX) / 2
    }
    // 글자가 없는 빈 칸은 버린다
    const filled = cells.filter((c) => c.text !== '')
    const text = normalize(filled.map((c) => c.text).join(' '))
    return { y, cells: filled, text, flat: flatten(text) }
  })

  return rows.sort((a, b) => b.y - a.y)
}

export function looksLikeForm1(rows: TextRow[]): boolean {
  return rows.some((r) => r.flat.includes('서식1') || r.flat.includes('선정평가표'))
}

export function looksLikeForm3(rows: TextRow[]): boolean {
  return rows.some((r) => r.flat.includes('서식3') || r.flat.includes('추천의견서'))
}

/** 열 가운데 위치들로부터 각 열이 차지하는 좌우 범위를 만든다 */
export function columnBounds(anchors: number[]): { lo: number; hi: number }[] {
  return anchors.map((a, i) => {
    const half = (j: number, k: number) => Math.abs(anchors[j] - anchors[k]) / 2
    const left = i > 0 ? (anchors[i - 1] + a) / 2 : a - (anchors.length > 1 ? half(1, 0) : 20)
    const right = i < anchors.length - 1 ? (a + anchors[i + 1]) / 2 : a + (anchors.length > 1 ? half(i, i - 1) : 20)
    return { lo: left, hi: right }
  })
}

/**
 * 한 줄에서 [lo, hi) 안에 들어오는 글자만 모아 잇는다.
 * 열이 좁아 이웃 열 글자까지 한 칸으로 붙어 버린 경우에도 글자 조각 단위로 다시 갈라
 * 자기 열의 글자만 가져온다. (출판사 이름이 길어 두세 줄로 접힐 때 꼭 필요하다)
 */
export function textInRange(row: TextRow, lo: number, hi: number): string {
  const width = hi - lo
  const out: string[] = []
  for (const c of row.cells) {
    if (c.endX <= lo || c.x >= hi) continue
    // 옆 칸 글자가 경계를 살짝 넘어온 것뿐이면 (문장 끝의 '?' 처럼) 이 열 글자가 아니다
    const overlap = Math.min(hi, c.endX) - Math.max(lo, c.x)
    if (overlap < Math.min(c.endX - c.x, width) * 0.25) continue
    for (const part of c.parts) {
      const mid = (part.x + part.endX) / 2
      if (mid < lo || mid >= hi) continue
      // 옆 칸(평가기준 문장 등)이 열 안까지 밀고 들어온 글자는 뺀다 — 열보다 넓은 조각은 이 열 것이 아니다
      if (part.endX - part.x > width) continue
      out.push((part.spaced && out.length ? ' ' : '') + part.text)
    }
  }
  return normalize(out.join(''))
}

/**
 * 서식1 한 쪽을 해석한다.
 * 기준점은 '합계' 줄의 숫자들이다: 첫 숫자 = 배점 합, 나머지 = 출판사별 총점.
 */
export function parseForm1(rows: TextRow[]): ParsedForm1 | null {
  const warnings: string[] = []
  const flatAll = rows.map((r) => r.flat).join(' ')
  const subjectName = normalize((flatAll.match(/과목\s*[:：]\s*(.+?)과(?:\s|위원|$)/) || [])[1] || '')
  const teacherName = normalize((flatAll.match(/위원\s*[:：]\s*(.+?)\(인\)/) || [])[1] || '')

  const totalRowIdx = rows.findIndex((r) => r.flat.startsWith('합계'))
  if (totalRowIdx < 0) return null
  const totalCells = rows[totalRowIdx].cells.filter((c) => isNumber(c.text))
  if (totalCells.length < 2) return null

  const pointsAnchor = totalCells[0].center
  const pubAnchors = totalCells.slice(1).map((c) => c.center)
  const totals = totalCells.slice(1).map((c) => Number(flatten(c.text)))
  const n = pubAnchors.length

  // 각 열이 차지하는 좌우 범위 (0번은 배점, 1번부터 출판사)
  const anchors = [pointsAnchor, ...pubAnchors]
  const bounds = columnBounds(anchors)
  const gaps: number[] = []
  for (let i = 1; i < anchors.length; i++) gaps.push(Math.abs(anchors[i] - anchors[i - 1]))
  const tol = Math.max(6, (gaps.length ? Math.min(...gaps) : 40) / 2 - 1)
  /** k번째 열(0=배점)의 글자 */
  const colText = (row: TextRow, k: number) => textInRange(row, bounds[k].lo, bounds[k].hi)
  /** k번째 열의 숫자 (숫자가 아니면 null) */
  const colNum = (row: TextRow, k: number) => {
    const t = colText(row, k)
    return t !== '' && isNumber(t) ? Number(flatten(t)) : null
  }

  // 본문(평가기준) 줄: 배점과 출판사 점수가 모두 있는 줄
  const bodyIdx: number[] = []
  for (let i = 0; i < totalRowIdx; i++) {
    if (colNum(rows[i], 0) === null) continue
    if (anchors.every((_, k) => k === 0 || colNum(rows[i], k) !== null)) bodyIdx.push(i)
  }
  const firstBody = bodyIdx.length ? bodyIdx[0] : totalRowIdx

  // 출판사명: 열 번호(1,2,3…) 줄과 첫 본문 줄 사이 줄에서 각 열의 글자를 모은다
  let idxRowIdx = -1
  for (let i = firstBody - 1; i >= 0; i--) {
    if (pubAnchors.every((_, k) => flatten(colText(rows[i], k + 1)) === String(k + 1))) {
      idxRowIdx = i
      break
    }
  }
  const nameRows = rows.slice(idxRowIdx >= 0 ? idxRowIdx + 1 : Math.max(0, firstBody - 1), firstBody)
  const publisherNames: string[] = pubAnchors.map(() => '')
  for (const row of nameRows) {
    // 이름이 길면 칸 안에서 여러 줄로 접히므로, 줄마다 자기 열의 글자만 꺼내 붙인다.
    // 줄이 바뀌면서 띄어쓰기가 사라지므로 줄 사이에는 공백을 넣지 않는다.
    pubAnchors.forEach((_, k) => {
      const t = colText(row, k + 1)
      if (t) publisherNames[k] += t
    })
  }
  publisherNames.forEach((v, i) => {
    publisherNames[i] = normalize(v)
    if (!publisherNames[i]) {
      publisherNames[i] = `출판사${i + 1}`
      warnings.push(`${i + 1}번째 출판사 이름을 읽지 못해 임시 이름을 넣었습니다.`)
    }
  })
  // 이름이 같으면 총괄표에서 한 줄로 합쳐져 한 곳이 사라진다 — 번호를 붙여 구분하고 알려 준다
  publisherNames.forEach((v, i) => {
    const first = publisherNames.findIndex((x) => flatten(x) === flatten(v))
    if (first < i) {
      publisherNames[i] = `${v} (${i + 1})`
      warnings.push(`${first + 1}번째와 ${i + 1}번째 출판사 이름이 '${v}' 로 똑같이 읽혔습니다. 이름을 확인해 주세요.`)
    }
  })

  // 평가기준 행: 배점·점수를 열에서 꺼내고 왼쪽 글자는 평가기준 문장으로 본다
  const criteria: ParsedCriterion[] = []
  const scores: number[][] = []
  const textStarts: number[] = []
  for (const i of bodyIdx) {
    const row = rows[i]
    scores.push(pubAnchors.map((_, k) => colNum(row, k + 1) ?? 0))
    const left = row.cells.filter((c) => c.center < bounds[0].lo)
    if (left.length) textStarts.push(left[0].x)
    criteria.push({ area: '', text: normalize(left.map((c) => c.text).join(' ')), points: colNum(row, 0) ?? 0 })
  }

  // 평가영역은 칸 병합 때문에 숫자 없는 별도 줄로 나온다.
  // 본문 글자가 시작하는 x보다 뚜렷하게 왼쪽이면 영역명, 아니면 앞 기준 문장이 이어지는 줄로 본다.
  const textStart = textStarts.length ? Math.min(...textStarts) : 0
  const areaLimit = textStart - Math.max(10, tol / 2)
  for (let i = 0; i < totalRowIdx; i++) {
    if (i < firstBody || bodyIdx.includes(i)) continue
    const row = rows[i]
    if (!row.cells.length) continue
    if (row.cells.some((c) => isNumber(c.text) && c.center > bounds[0].lo)) continue
    let best = 0
    let bestD = Infinity
    bodyIdx.forEach((b, k) => {
      const d = Math.abs(rows[b].y - row.y)
      if (d < bestD) {
        bestD = d
        best = k
      }
    })
    const target = criteria[best]
    if (!target) continue
    if (row.cells[0].x <= areaLimit) target.area = normalize(`${target.area} ${row.text}`)
    else target.text = normalize(`${target.text} ${row.text}`)
  }

  // 검산: 항목 점수 합과 표의 합계가 다르면 알려 준다 (합계를 신뢰)
  if (criteria.length) {
    for (let c = 0; c < n; c++) {
      const sum = scores.reduce((acc, r) => acc + (r[c] || 0), 0)
      if (sum !== totals[c]) warnings.push(`${publisherNames[c]}: 항목 점수 합(${sum})과 표의 합계(${totals[c]})가 다릅니다.`)
    }
  } else {
    warnings.push('평가기준 행을 읽지 못해 합계만 가져왔습니다.')
  }

  // 종합의견: '종합의견' 줄 다음부터 끝까지
  const opinionIdx = rows.findIndex((r, i) => i > totalRowIdx && r.flat.includes('종합의견'))
  const summaryOpinion = opinionIdx >= 0 ? normalize(rows.slice(opinionIdx + 1).map((r) => r.text).join(' ')) : ''

  if (!subjectName) warnings.push('과목명을 읽지 못했습니다.')
  if (!teacherName) warnings.push('위원 이름을 읽지 못했습니다.')

  return { subjectName, teacherName, publisherNames, totals, criteria, scores, summaryOpinion, warnings }
}

/**
 * 서식3(개인 추천의견) 한 쪽에서 순위별 출판사·의견을 읽는다.
 * 순위 숫자와 출판사명은 칸 안에서 세로 가운데에 놓이므로, 의견 글줄과 다른 줄에 나온다.
 * 그래서 순위 숫자의 y를 경계로 삼아 각 줄이 어느 순위에 속하는지 나눈다.
 */
/** 서식3 아래 서명줄 '작성자 직 교사 성명 홍길동 (인)' 에서 작성자 이름을 읽는다 */
export function parseForm3Writer(rows: TextRow[]): string {
  const line = rows.find((r) => r.flat.includes('작성자'))
  const m = (line?.flat || '').match(/성명\s*(.+?)\s*\(인\)/)
  return m ? m[1].replace(/\s+/g, '') : ''
}

export function parseForm3(rows: TextRow[]): ParsedRecommend[] {
  const headIdx = rows.findIndex((r) => r.flat.includes('순위') && r.flat.includes('출판사명'))
  if (headIdx < 0) return []
  const head = rows[headIdx]
  const rankCell = head.cells.find((c) => c.text.includes('순위'))
  const pubCell = head.cells.find((c) => flatten(c.text).includes('출판사명'))
  if (!rankCell || !pubCell) return []
  const colTol = Math.max(10, (pubCell.center - rankCell.center) / 2 - 2)
  // 열 경계: 순위 | 출판사명 | 추천 의견
  // 머리글 '추 천 의 견' 은 넓은 칸 가운데에 놓이므로 경계로 쓸 수 없다.
  // 출판사 칸의 가운데에서 좌우로 벌린 범위를 쓰고, 오른쪽은 의견 글이 시작하는 x 까지 넓힌다.
  const pubLo = (rankCell.center + pubCell.center) / 2

  let endIdx = rows.length
  for (let i = headIdx + 1; i < rows.length; i++) {
    if (/작성자|확인자|교과협의회|※/.test(rows[i].flat)) {
      endIdx = i
      break
    }
  }
  const body = rows.slice(headIdx + 1, endIdx)

  // 의견 글이 시작하는 x (출판사 칸보다 오른쪽에서 가장 왼쪽 글자)
  const rightXs = body.flatMap((r) => r.cells.flatMap((c) => c.parts.map((t) => t.x))).filter((x) => x > pubCell.center + colTol)
  const pubHi = rightXs.length ? (pubCell.center + colTol + Math.min(...rightXs)) / 2 : pubCell.center + colTol

  // 순위 숫자 위치 찾기
  const marks: { rank: number; y: number }[] = []
  for (const row of body) {
    for (const c of row.cells) {
      if (Math.abs(c.center - rankCell.center) > colTol) continue
      const v = flatten(c.text)
      if (/^[123]$/.test(v) && !marks.some((m) => m.rank === Number(v))) marks.push({ rank: Number(v), y: row.y })
    }
  }
  if (!marks.length) return []
  marks.sort((a, b) => b.y - a.y)

  // 순위 사이의 중간 높이를 경계로 각 줄을 배정한다
  const bounds = marks.map((m, i) => (i === marks.length - 1 ? -Infinity : (m.y + marks[i + 1].y) / 2))
  const out: ParsedRecommend[] = marks.map((m) => ({ rank: m.rank, publisherName: '', text: '' }))
  for (const row of body) {
    const idx = bounds.findIndex((b) => row.y > b)
    const entry = out[idx < 0 ? out.length - 1 : idx]
    if (!entry) continue
    // 열 범위로 글자를 나눈다 — 이름이 길어 이웃 칸과 붙어 읽혀도 자기 열만 가져온다.
    // 이름은 칸 안에서 줄이 접히며 붙는 것이라 공백 없이, 의견 글은 줄 단위라 공백을 넣어 잇는다.
    const name = textInRange(row, pubLo, pubHi)
    if (name) entry.publisherName += name
    const opinion = textInRange(row, pubHi, Infinity)
    if (opinion) entry.text = normalize(`${entry.text} ${opinion}`)
  }
  out.forEach((e) => (e.publisherName = normalize(e.publisherName)))
  return out.sort((a, b) => a.rank - b.rank)
}
