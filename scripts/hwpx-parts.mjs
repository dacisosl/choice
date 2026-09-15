#!/usr/bin/env node
/**
 * 원본 한글 서식(assets/선정계획안-원본서식.hwpx)에서
 * 서식1·2·3 부분만 뽑아 public/forms/ 에 XML 조각으로 저장한다.
 *
 * 앱은 이 조각을 받아 칸에 값만 채운 뒤 다시 hwpx(zip)로 묶어 내려 준다.
 * XML 그대로 두는 이유: 압축을 풀 필요가 없어 브라우저에서 바로 쓸 수 있고,
 * 서식·글꼴·도장란이 원본과 100% 같아진다.
 *
 *   node scripts/hwpx-parts.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const SRC = 'assets/선정계획안-원본서식.hwpx'
const OUT = 'public/forms'

// ───────── zip 읽기 (중앙 디렉터리 훑기) ─────────
function unzip(buf) {
  const files = {}
  // End of central directory
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('zip 이 아닙니다')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const lho = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf-8')
    const lNameLen = buf.readUInt16LE(lho + 26)
    const lExtraLen = buf.readUInt16LE(lho + 28)
    const start = lho + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + csize)
    files[name] = method === 8 ? inflateRawSync(raw) : Buffer.from(raw)
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

// ───────── 문단 훑기 (표 안의 문단은 건드리지 않는다) ─────────
/** <hs:sec> 바로 아래 <hp:p> 들의 [시작, 끝] 위치 */
function topParagraphs(xml) {
  const out = []
  let depth = 0
  let start = -1
  const re = /<hp:p\b[^>]*?(\/?)>|<\/hp:p>/g
  let m
  while ((m = re.exec(xml))) {
    const selfClose = m[0].endsWith('/>')
    if (m[0].startsWith('</')) {
      depth--
      if (depth === 0 && start >= 0) {
        out.push([start, re.lastIndex])
        start = -1
      }
    } else if (!selfClose) {
      if (depth === 0) start = m.index
      depth++
    } else if (depth === 0) out.push([m.index, re.lastIndex])
  }
  return out
}

const textOf = (xml) => xml.replace(/<[^>]+>/g, '')

const files = unzip(readFileSync(SRC))
const dec = (n) => files[n].toString('utf-8')
mkdirSync(OUT, { recursive: true })

// 1) 머리말(글꼴·문단모양·테두리 모음) — 세 서식이 함께 쓴다
writeFileSync(`${OUT}/header.xml`, dec('Contents/header.xml'))

/**
 * 줄 나눔 캐시(linesegarray) 를 뺀다.
 * 한글이 이 캐시를 믿고 그리기 때문에, 칸의 글자를 바꾸면 '한 줄로 쓰기' 를 켠 것처럼
 * 한 줄에 눌러 담겨 나온다. 캐시가 없으면 한글이 문서를 열 때 스스로 다시 계산한다.
 */
const dropLineSegs = (xml) => xml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '')

/**
 * 편집 용지 여백을 줄여 한 쪽에 더 많이 들어가게 한다.
 * 원본: 위·아래 15mm, 머리말·꼬리말 10mm, 왼·오른 20mm → 위·아래 10mm, 머리말·꼬리말 5mm, 왼·오른 15mm
 * (1mm = 283.46 HWPUNIT). 표 너비는 앱이 새 본문 너비에 맞춰 다시 맞춘다 (src/lib/hwpxDoc.ts).
 */
const roomyMargins = (xml) =>
  xml.replace(/<hp:margin header="\d+" footer="\d+" gutter="(\d+)" left="\d+" right="\d+" top="\d+" bottom="\d+"\/>/, '<hp:margin header="1417" footer="1417" gutter="$1" left="4252" right="4252" top="2835" bottom="2835"/>')

/** 표가 한 쪽을 넘치면 통째로 다음 쪽에 가지 않고 줄 단위로 나뉘게 한다 */
const splitByRow = (xml) => xml.replace(/(<hp:tbl\b[^>]*?)pageBreak="NONE"/g, '$1pageBreak="CELL"')

const tidy = (xml) => splitByRow(roomyMargins(dropLineSegs(xml)))

// 2) 서식1 — section1.xml 이 통째로 서식1 이다
writeFileSync(`${OUT}/form1.xml`, tidy(dec('Contents/section1.xml')))

// 3) 서식2·서식3 — section2.xml 에서 잘라 낸다
const sec2 = dec('Contents/section2.xml')
const paras = topParagraphs(sec2)
const head = sec2.slice(0, paras[0][0]) // <?xml …?><hs:sec …>
const labelAt = (label) => paras.findIndex(([a, b]) => textOf(sec2.slice(a, b)).includes(label))
const i2 = labelAt('【서식2】')
const i3 = labelAt('【서식3】')
const i4 = labelAt('【서식4】')
if (i2 < 0 || i3 < 0 || i4 < 0) throw new Error(`서식 구분을 찾지 못했습니다 (${i2}/${i3}/${i4})`)

/** 첫 문단이 가지고 있던 쪽 모양(secPr) 을 잘라 낸 첫 문단에 옮겨 붙인다 */
const firstPara = sec2.slice(paras[0][0], paras[0][1])
const secRun = firstPara.match(/<hp:run charPrIDRef="\d+">\s*(?:<hp:ctrl>.*?<\/hp:ctrl>)?\s*<hp:secPr[\s\S]*?<\/hp:secPr>\s*<\/hp:run>/)
if (!secRun) throw new Error('secPr 을 찾지 못했습니다')

function cut(from, to) {
  const body = paras.slice(from, to).map(([a, b]) => sec2.slice(a, b))
  // 첫 문단 여는 태그 바로 뒤에 쪽 모양을 넣는다
  body[0] = body[0].replace(/^(<hp:p\b[^>]*>)/, `$1${secRun[0]}`)
  return `${head}${body.join('')}</hs:sec>`
}
writeFileSync(`${OUT}/form2.xml`, tidy(cut(i2, i3)))
writeFileSync(`${OUT}/form3.xml`, tidy(cut(i3, i4)))

// 4) 나머지 뼈대 파일 (앱이 그대로 다시 넣는다)
for (const n of ['version.xml', 'settings.xml', 'META-INF/container.xml', 'META-INF/container.rdf']) {
  let xml = dec(n)
  // 커서 위치는 원본 문서(계획안) 기준이라 잘라 낸 문서에는 없는 자리를 가리킨다. 맨 앞으로 돌린다
  if (n === 'settings.xml') xml = xml.replace(/<ha:CaretPosition[^>]*\/>/, '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>')
  writeFileSync(`${OUT}/${n.replace(/\//g, '_')}`, xml)
}

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)}KB`
console.log(`${OUT}/header.xml ${kb(dec('Contents/header.xml'))}`)
console.log(`${OUT}/form1.xml ${kb(dec('Contents/section1.xml'))} · form2.xml ${kb(readFileSync(`${OUT}/form2.xml`, 'utf-8'))} · form3.xml ${kb(readFileSync(`${OUT}/form3.xml`, 'utf-8'))}`)
