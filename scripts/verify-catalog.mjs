#!/usr/bin/env node
/**
 * 원본 웹전시 목록(엑셀)의 모든 행이 public/catalog.json 에 들어갔는지 한 줄도 빠짐없이 확인한다.
 *
 *   node scripts/verify-catalog.mjs                      # assets/웹전시목록-*.xls ↔ public/catalog.json
 *   node scripts/verify-catalog.mjs 다른자료.json         # 다른 자료 파일과 대조
 *
 * 빠진 것이 하나라도 있으면 0 이 아닌 값으로 끝난다.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const XLSX = createRequire(import.meta.url)('xlsx')
const catFile = process.argv[2] || 'public/catalog.json'
const FILES = [
  ['assets/웹전시목록-중학교.xls', '중'],
  ['assets/웹전시목록-고등학교.xls', '고'],
]

const clean = (s) => String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
const squeeze = (t) => t.replace(/[\s·･⋅ㆍ]/g, '').toLowerCase()
const read = (f) => {
  const wb = XLSX.read(readFileSync(f), { type: 'buffer' })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }).slice(1).filter((r) => clean(r[4]))
}
/** 변환기와 같은 규칙: 고등학교는 서명2 를 이름에 붙이고, 중학교의 권 표시는 붙이지 않는다 */
const nameOf = (school, base, vol) => (vol && school === '고' ? `${base}${/^[0-9ⅠⅡⅢ]+$/.test(vol) ? '' : ' '}${vol}` : base)

const cat = JSON.parse(readFileSync(catFile, 'utf8'))
const have = new Map() // `${school}|${squeeze(name)}` → Set(publisher)
for (const s of cat.subjects) have.set(`${s.school}|${squeeze(s.name)}`, new Set(s.publishers.map((p) => (typeof p === 'string' ? p : p.name))))

let rows = 0, missSub = [], missPub = [], pairs = new Set(), dupRows = 0
const seen = new Set()
for (const [file, school] of FILES) {
  for (const r of read(file)) {
    rows++
    const base = clean(r[4]), vol = clean(r[5]), pub = clean(r[9])
    const name = nameOf(school, base, vol)
    const key = `${school}|${squeeze(name)}`
    const rowKey = `${key}|${pub}`
    if (seen.has(rowKey)) dupRows++
    seen.add(rowKey)
    pairs.add(rowKey)
    const set = have.get(key)
    if (!set) { missSub.push(`${school} ${name} (${pub})`); continue }
    if (!set.has(pub)) missPub.push(`${school} ${name} → ${pub}`)
  }
}
const catPairs = [...have.values()].reduce((a, s) => a + s.size, 0)
console.log(`원본 행 ${rows} · 과목×발행사 쌍 ${pairs.size} (같은 과목에 같은 발행사가 또 나온 행 ${dupRows})`)
console.log(`자료 파일 과목 ${cat.subjects.length} · 등록된 과목×발행사 ${catPairs}`)
console.log(`빠진 과목 ${missSub.length} · 빠진 발행사 ${missPub.length}`)
if (missSub.length) console.log('  빠진 과목:', missSub.slice(0, 20).join(' / '))
if (missPub.length) console.log('  빠진 발행사:', missPub.slice(0, 20).join(' / '))

// 자료에만 있고 원본에 없는 것 (군더더기)
let extra = []
for (const [key, set] of have) for (const p of set) if (!pairs.has(`${key}|${p}`)) extra.push(`${key} → ${p}`)
console.log(`원본에 없는 항목 ${extra.length}${extra.length ? ': ' + extra.slice(0, 20).join(' / ') : ''}`)

// 본보기 확인
for (const [school, n] of [['고', '문학과 영상'], ['고', '생태와 환경'], ['중', '국어'], ['중', '미술'], ['고', '심화 영어Ⅰ'], ['고', '공통국어1']]) {
  const set = have.get(`${school}|${squeeze(n)}`)
  console.log(`  ${school} ${n}: ${set ? set.size + '곳 — ' + [...set].join(', ') : '없음 ❌'}`)
}
process.exit(missSub.length + missPub.length + extra.length ? 1 : 0)
