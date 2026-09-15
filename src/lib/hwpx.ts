/**
 * 한글 문서(.hwpx) 만들기 — 교육청 원본 서식의 칸에 값만 채워 넣는다.
 *
 * hwpx 는 XML 여러 개를 zip 으로 묶은 공개 표준(OWPML)이다.
 * public/forms/ 에 원본에서 뽑아 둔 XML 조각(머리말·서식1·2·3)을 두고,
 * 여기서는 표의 칸 글자만 바꾼 뒤 zip 으로 다시 묶는다.
 * 서식·글꼴·도장란이 원본 그대로라 한글에서 열어 바로 제출할 수 있다.
 */

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ───────────── 조각 받아 오기 ─────────────
const cache = new Map<string, Promise<string>>()

export function loadPart(name: string): Promise<string> {
  let p = cache.get(name)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}forms/${name}`).then((r) => {
      if (!r.ok) throw new Error(`서식 파일을 받지 못했습니다 (${name})`)
      return r.text()
    })
    cache.set(name, p)
  }
  return p
}

// ───────────── 표 다루기 ─────────────

/** n 번째 표(<hp:tbl>)의 위치 */
function tableRange(xml: string, index: number): [number, number] {
  let from = 0
  for (let i = 0; ; i++) {
    const a = xml.indexOf('<hp:tbl ', from)
    if (a < 0) throw new Error('표를 찾지 못했습니다')
    const b = xml.indexOf('</hp:tbl>', a) + 9
    if (i === index) return [a, b]
    from = b
  }
}

/** 표 안의 <hp:tr> 조각들 */
function splitRows(tbl: string): string[] {
  return tbl.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) || []
}

/** 칸 하나의 글자를 바꾼다. 줄바꿈은 문단을 나눈다 */
function setCellText(tc: string, text: string): string {
  const m = /(<hp:subList\b[^>]*>)([\s\S]*?)(<\/hp:subList>)/.exec(tc)
  if (!m) return tc
  const inner = m[2]
  const pOpen = /<hp:p\b[^>]*>/.exec(inner)?.[0] || '<hp:p id="2147483648" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
  const charPr = /<hp:run charPrIDRef="(\d+)"/.exec(inner)?.[1] || '0'
  // 줄 나눔 캐시(linesegarray)는 넣지 않는다 — 남아 있으면 한글이 '한 줄로 쓰기'처럼 그린다
  const body = String(text ?? '')
    .split('\n')
    .map((line) => `${pOpen}<hp:run charPrIDRef="${charPr}">${line ? `<hp:t>${esc(line)}</hp:t>` : ''}</hp:run></hp:p>`)
    .join('')
  return tc.slice(0, m.index) + m[1] + body + m[3] + tc.slice(m.index + m[0].length)
}

export interface CellFill {
  row: number
  col: number
  text: string
}

/** 표의 칸들을 한 번에 채운다 (자리는 원본의 행·열 번호 그대로) */
export function fillTable(xml: string, tableIndex: number, fills: CellFill[]): string {
  const [a, b] = tableRange(xml, tableIndex)
  let tbl = xml.slice(a, b)
  const want = new Map(fills.map((f) => [`${f.row},${f.col}`, f.text]))
  tbl = tbl.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, (tc) => {
    const addr = /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>/.exec(tc)
    if (!addr) return tc
    const key = `${addr[2]},${addr[1]}`
    return want.has(key) ? setCellText(tc, want.get(key) as string) : tc
  })
  return xml.slice(0, a) + tbl + xml.slice(b)
}

/**
 * 표의 가운데 줄(자료 줄) 수를 원하는 만큼 맞춘다.
 * 늘릴 때는 마지막 자료 줄을 본떠 넣고, 줄일 때는 지운다. 뒤따르는 줄 번호도 다시 매긴다.
 */
export function setDataRows(xml: string, tableIndex: number, firstRow: number, lastRow: number, want: number): string {
  const [a, b] = tableRange(xml, tableIndex)
  let tbl = xml.slice(a, b)
  const rows = splitRows(tbl)
  const have = lastRow - firstRow + 1
  if (want === have || want < 1) return xml

  const head = rows.slice(0, firstRow)
  const data = rows.slice(firstRow, lastRow + 1)
  const tail = rows.slice(lastRow + 1)
  const nextData = want > have ? [...data, ...Array.from({ length: want - have }, () => data[data.length - 1])] : data.slice(0, want)

  // 줄 번호를 처음부터 다시 매긴다
  const renum = (row: string, rowAddr: number) => row.replace(/<hp:cellAddr colAddr="(\d+)" rowAddr="\d+"\/>/g, (_, c) => `<hp:cellAddr colAddr="${c}" rowAddr="${rowAddr}"/>`)
  const all = [...head, ...nextData, ...tail].map((row, i) => renum(row, i))

  const rebuilt = tbl.slice(0, tbl.indexOf('<hp:tr>')) + all.join('') + tbl.slice(tbl.lastIndexOf('</hp:tr>') + 8)
  const fixed = rebuilt.replace(/(<hp:tbl\b[^>]*?)rowCnt="\d+"/, `$1rowCnt="${all.length}"`)
  return xml.slice(0, a) + fixed + xml.slice(b)
}

/**
 * 쓰지 않는 열을 아예 없앤다 (출판사 3곳이면 3칸만 남게).
 * 없앤 열의 너비는 `absorb` 로 준 열들이 나눠 가져 표 전체 너비는 그대로 둔다.
 * @param remove 없앨 열 번호(원본 기준)
 * @param absorb 그 너비를 가져갈 열 번호(원본 기준). 그 줄에 없으면 건너뛴다
 */
export function dropColumns(xml: string, tableIndex: number, remove: number[], absorb: number[]): string {
  if (!remove.length) return xml
  const [a, b] = tableRange(xml, tableIndex)
  const tbl = xml.slice(a, b)
  const gone = new Set(remove)
  /** 원본 열 번호 → 새 열 번호 */
  const newCol = (col: number) => col - remove.filter((r) => r < col).length

  const rows = splitRows(tbl).map((row) => {
    const cells = row.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) || []
    const parsed = cells.map((raw) => {
      const addr = /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>/.exec(raw)
      const span = /<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"\/>/.exec(raw)
      const size = /<hp:cellSz width="(\d+)" height="(\d+)"\/>/.exec(raw)
      return {
        raw,
        col: addr ? Number(addr[1]) : 0,
        row: addr ? Number(addr[2]) : 0,
        colSpan: span ? Number(span[1]) : 1,
        width: size ? Number(size[1]) : 0,
      }
    })
    // 이 줄에서 없애는 칸(한 칸짜리)의 너비를 모은다
    let freed = 0
    const keep = parsed.filter((c) => {
      if (c.colSpan === 1 && gone.has(c.col)) {
        freed += c.width
        return false
      }
      return true
    })
    const targets = keep.filter((c) => c.colSpan === 1 && absorb.includes(c.col))
    const share = targets.length ? Math.floor(freed / targets.length) : 0
    const extra = targets.length ? freed - share * targets.length : 0

    return keep
      .map((c, i) => {
        let out = c.raw
        // 여러 열에 걸친 칸은 없앤 열만큼 걸침 수를 줄인다 (너비는 그대로)
        if (c.colSpan > 1) {
          const covered = remove.filter((r) => r >= c.col && r < c.col + c.colSpan).length
          if (covered) out = out.replace(/<hp:cellSpan colSpan="\d+"/, `<hp:cellSpan colSpan="${c.colSpan - covered}"`)
        } else if (targets.includes(c)) {
          const add = share + (c === targets[0] ? extra : 0)
          out = out.replace(/<hp:cellSz width="\d+"/, `<hp:cellSz width="${c.width + add}"`)
        }
        void i
        return out.replace(/<hp:cellAddr colAddr="\d+"/, `<hp:cellAddr colAddr="${newCol(c.col)}"`)
      })
      .join('')
  })

  const colCnt = Number(/<hp:tbl\b[^>]*colCnt="(\d+)"/.exec(tbl)?.[1] || 0) - remove.length
  const rebuilt =
    tbl.slice(0, tbl.indexOf('<hp:tr>')) +
    rows.map((r) => `<hp:tr>${r}</hp:tr>`).join('') +
    tbl.slice(tbl.lastIndexOf('</hp:tr>') + 8)
  return xml.slice(0, a) + rebuilt.replace(/(<hp:tbl\b[^>]*?)colCnt="\d+"/, `$1colCnt="${colCnt}"`) + xml.slice(b)
}

/** 표의 칸을 { 원문, 열, 줄, 걸침 } 으로 읽는다 */
function parseCells(row: string) {
  return (row.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) || []).map((raw) => {
    const addr = /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>/.exec(raw)
    const span = /<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"\/>/.exec(raw)
    const size = /<hp:cellSz width="(\d+)" height="(\d+)"\/>/.exec(raw)
    return {
      raw,
      col: addr ? Number(addr[1]) : 0,
      row: addr ? Number(addr[2]) : 0,
      colSpan: span ? Number(span[1]) : 1,
      rowSpan: span ? Number(span[2]) : 1,
      width: size ? Number(size[1]) : 0,
      height: size ? Number(size[2]) : 0,
    }
  })
}

/** 지금 표의 열 너비 (한 칸짜리 칸에서 읽는다) */
export function columnWidths(xml: string, tableIndex: number): number[] {
  const [a, b] = tableRange(xml, tableIndex)
  const tbl = xml.slice(a, b)
  const n = Number(/<hp:tbl\b[^>]*colCnt="(\d+)"/.exec(tbl)?.[1] || 0)
  const out = new Array<number>(n).fill(0)
  for (const row of splitRows(tbl)) for (const c of parseCells(row)) if (c.colSpan === 1 && !out[c.col]) out[c.col] = c.width
  return out
}

/**
 * 열 너비를 통째로 다시 놓는다. 여러 열에 걸친 칸은 걸친 열의 합, 표 너비는 전체 합이 된다.
 * 편집 용지 여백을 바꿔 본문 너비가 달라졌을 때 표를 그 너비에 맞추는 데 쓴다.
 */
export function layoutColumns(xml: string, tableIndex: number, widths: number[]): string {
  const [a, b] = tableRange(xml, tableIndex)
  const tbl = xml.slice(a, b)
  const sum = (from: number, span: number) => widths.slice(from, from + span).reduce((s, w) => s + (w || 0), 0)
  const rows = splitRows(tbl).map((row) =>
    parseCells(row)
      .map((c) => c.raw.replace(/<hp:cellSz width="\d+"/, `<hp:cellSz width="${sum(c.col, c.colSpan)}"`))
      .join(''),
  )
  const total = sum(0, widths.length)
  const rebuilt =
    tbl.slice(0, tbl.indexOf('<hp:tr>')) +
    rows.map((r) => `<hp:tr>${r}</hp:tr>`).join('') +
    tbl.slice(tbl.lastIndexOf('</hp:tr>') + 8)
  return xml.slice(0, a) + rebuilt.replace(/(<hp:sz\b[^>]*?)width="\d+"/, `$1width="${total}"`) + xml.slice(b)
}

/** 표를 원하는 너비로 비율 그대로 늘리거나 줄인다 */
export function scaleTable(xml: string, tableIndex: number, totalWidth: number): string {
  const cur = columnWidths(xml, tableIndex)
  const curTotal = cur.reduce((s, w) => s + w, 0)
  if (!curTotal) return xml
  const next = cur.map((w) => Math.round((w * totalWidth) / curTotal))
  next[next.length - 1] += totalWidth - next.reduce((s, w) => s + w, 0)
  return layoutColumns(xml, tableIndex, next)
}

/**
 * 줄 높이(최소 높이)를 바꾼다. 여러 줄에 걸친 칸은 걸친 줄의 합이 된다.
 * 한글은 글이 넘치면 알아서 늘리므로, 여기서는 빈 채로 너무 높던 줄을 낮추는 데 쓴다.
 * @param heights 줄 번호 → 높이(HWPUNIT). 없는 줄은 지금 값을 둔다
 */
export function setRowHeights(xml: string, tableIndex: number, heights: Record<number, number>): string {
  const [a, b] = tableRange(xml, tableIndex)
  const tbl = xml.slice(a, b)
  const rows = splitRows(tbl).map(parseCells)
  // 지금 줄 높이는 그 줄의 한 줄짜리 칸에서 읽는다
  const cur = rows.map((cells, i) => heights[i] ?? Math.min(...cells.filter((c) => c.rowSpan === 1).map((c) => c.height).concat([Number.POSITIVE_INFINITY])))
  const fallback = Math.min(...cur.filter((h) => Number.isFinite(h)))
  const h = cur.map((v) => (Number.isFinite(v) ? v : fallback))
  const sum = (from: number, span: number) => h.slice(from, from + span).reduce((s, v) => s + v, 0)
  const out = rows.map((cells) => cells.map((c) => c.raw.replace(/(<hp:cellSz width="\d+") height="\d+"/, `$1 height="${sum(c.row, c.rowSpan)}"`)).join(''))
  const rebuilt =
    tbl.slice(0, tbl.indexOf('<hp:tr>')) +
    out.map((r) => `<hp:tr>${r}</hp:tr>`).join('') +
    tbl.slice(tbl.lastIndexOf('</hp:tr>') + 8)
  return xml.slice(0, a) + rebuilt.replace(/(<hp:sz\b[^>]*?)height="\d+"/, `$1height="${sum(0, h.length)}"`) + xml.slice(b)
}

// ───────────── 본문 문단 다루기 ─────────────

/** 표 바깥 문단 중 글자가 `find` 로 시작하는 첫 문단의 글자를 바꾼다 */
export function replaceParagraph(xml: string, find: string, text: string): string {
  const re = /<hp:p\b[^>]*>(?:(?!<hp:tbl|<\/hp:p>)[\s\S])*?<\/hp:p>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const para = m[0]
    const plain = (para.match(/<hp:t>([\s\S]*?)<\/hp:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')
    if (!plain.replace(/\s/g, '').startsWith(find.replace(/\s/g, ''))) continue
    const charPr = /<hp:run charPrIDRef="(\d+)"/.exec(para)?.[1] || '0'
    const pOpen = /<hp:p\b[^>]*>/.exec(para)?.[0] as string
    const next = `${pOpen}<hp:run charPrIDRef="${charPr}"><hp:t>${esc(text)}</hp:t></hp:run></hp:p>`
    return xml.slice(0, m.index) + next + xml.slice(m.index + para.length)
  }
  return xml
}

// ───────────── hwpx(zip) 묶기 ─────────────

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array<ArrayBuffer>): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface Entry {
  name: string
  data: Uint8Array<ArrayBuffer>
}

/** 압축 없이(STORE) zip 을 만든다 — 한글이 그대로 읽는다 */
function zip(entries: Entry[]): Blob {
  const enc = new TextEncoder()
  const locals: Uint8Array<ArrayBuffer>[] = []
  const centrals: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (const e of entries) {
    const name = enc.encode(e.name)
    const crc = crc32(e.data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version
    lv.setUint16(6, 0, true) // flags
    lv.setUint16(8, 0, true) // 0 = 압축 없음
    lv.setUint16(10, 0, true) // time
    lv.setUint16(12, 0x21, true) // date (1996-01-01)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, e.data.length, true)
    lv.setUint32(22, e.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    locals.push(local, e.data)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, e.data.length, true)
    cv.setUint32(24, e.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.length + e.data.length
  }
  const centralSize = centrals.reduce((a, c) => a + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  return new Blob([...locals, ...centrals, end], { type: 'application/hwp+zip' })
}

const HPF = (sections: number, title: string) => {
  const items = Array.from({ length: sections }, (_, i) => `<opf:item id="section${i}" href="Contents/section${i}.xml" media-type="application/xml"/>`).join('')
  const refs = Array.from({ length: sections }, (_, i) => `<opf:itemref idref="section${i}" linear="yes"/>`).join('')
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><opf:package xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" version="" unique-identifier="" id=""><opf:metadata><opf:title>${esc(title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text"></opf:meta><opf:meta name="CreatedDate" content="text">${now}</opf:meta><opf:meta name="ModifiedDate" content="text">${now}</opf:meta></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>${items}<opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/>${refs}</opf:spine></opf:package>`
}

/** 미리보기 그림 자리를 채울 아주 작은 흰 PNG (1×1) */
const PRV_IMAGE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 한글이 문서를 열 때 쓰는 빈 목록 파일 */
const MANIFEST = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>'

export interface HwpxDoc {
  /** 쪽 차례대로 넣을 구역(서식) XML */
  sections: string[]
  title: string
  /** 탐색기 미리보기에 들어갈 짧은 글 */
  preview?: string
}

/** 구역 XML 들을 한글 문서 하나로 묶는다 */
export async function buildHwpx({ sections, title, preview }: HwpxDoc): Promise<Blob> {
  const enc = new TextEncoder()
  const [header, version, settings, container, rdf] = await Promise.all([
    loadPart('header.xml'),
    loadPart('version.xml'),
    loadPart('settings.xml'),
    loadPart('META-INF_container.xml'),
    loadPart('META-INF_container.rdf'),
  ])
  // 머리말의 구역 수는 원본(3구역) 그대로라 우리 문서와 맞춰 줘야 한다.
  // 이 숫자가 어긋나면 한글이 '손상된 파일'이라고 한다.
  const head = header.replace(/(<hh:head\b[^>]*?)secCnt="\d+"/, `$1secCnt="${sections.length}"`)

  // 파일 순서는 원본과 같게 둔다 (mimetype 이 반드시 맨 앞)
  const entries: Entry[] = [
    { name: 'mimetype', data: enc.encode('application/hwp+zip') },
    { name: 'version.xml', data: enc.encode(version) },
    { name: 'Contents/header.xml', data: enc.encode(head) },
    ...sections.map((xml, i) => ({ name: `Contents/section${i}.xml`, data: enc.encode(xml) })),
    { name: 'Preview/PrvText.txt', data: enc.encode(preview || title) },
    { name: 'settings.xml', data: enc.encode(settings) },
    { name: 'Preview/PrvImage.png', data: base64ToBytes(PRV_IMAGE) },
    { name: 'META-INF/container.rdf', data: enc.encode(rdf) },
    { name: 'Contents/content.hpf', data: enc.encode(HPF(sections.length, title)) },
    { name: 'META-INF/container.xml', data: enc.encode(container) },
    { name: 'META-INF/manifest.xml', data: enc.encode(MANIFEST) },
  ]
  return zip(entries)
}

/** 파일로 내려받기 */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/[\\/:*?"<>|]/g, ' ').trim()
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
