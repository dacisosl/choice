#!/usr/bin/env node
/**
 * 원본 웹전시 목록(엑셀)의 모든 행이 public/catalog.json 에 들어갔는지 한 줄도 빠짐없이 확인한다.
 * 변환기와 따로 계산해 맞춰 보므로, 변환기가 틀리면 여기서 걸린다.
 *
 *   node scripts/verify-catalog.mjs                 # assets/웹전시목록-*.xls ↔ public/catalog.json
 *   node scripts/verify-catalog.mjs 다른자료.json    # 다른 자료 파일과 대조
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
const leadAuthor = (a) => clean(a).split(/\s*외\s*/)[0].trim()
/** 고등학교의 '1·Ⅱ' 는 과목명의 일부, 중학교의 '1-1·①' 은 권 표시라 빼고 합친다 */
const nameOf = (school, base, vol) => (vol && school === '고' ? `${base}${/^[0-9ⅠⅡⅢ]+$/.test(vol) ? '' : ' '}${vol}` : base)
const read = (f) => {
  const wb = XLSX.read(readFileSync(f), { type: 'buffer' })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }).slice(1).filter((r) => clean(r[4]))
}

// ── 원본에서 기대되는 (과목, 발행사 줄) 을 만든다
const want = new Map() // 과목키 → Map(발행사 → Map(대표저자 → true))
let rows = 0
for (const [file, school] of FILES) {
  for (const r of read(file)) {
    rows++
    const key = `${school}|${squeeze(nameOf(school, clean(r[4]), clean(r[5])))}`
    const pub = clean(r[9])
    if (!want.has(key)) want.set(key, new Map())
    const perPub = want.get(key)
    if (!perPub.has(pub)) perPub.set(pub, new Map())
    const lead = leadAuthor(r[8])
    if (lead) perPub.get(pub).set(lead, true)
  }
}
/** 한 발행사가 두 종 이상 냈으면 대표저자를 붙인 줄이 각각 있어야 한다 */
const wantLabels = new Map()
for (const [key, perPub] of want) {
  const set = new Set()
  for (const [pub, leads] of perPub) {
    if (leads.size < 2) set.add(pub)
    else for (const lead of leads.keys()) set.add(`${pub}(${lead})`)
  }
  wantLabels.set(key, set)
}

// ── 자료 파일이 가진 것
const cat = JSON.parse(readFileSync(catFile, 'utf8'))
const have = new Map()
for (const s of cat.subjects) have.set(`${s.school}|${squeeze(s.name)}`, new Set(s.publishers.map((p) => (typeof p === 'string' ? p : p.name))))

const missSub = [], missPub = [], extra = []
let wantPairs = 0
for (const [key, set] of wantLabels) {
  wantPairs += set.size
  const got = have.get(key)
  if (!got) { missSub.push(`${key} (${[...set].join(', ')})`); continue }
  for (const label of set) if (!got.has(label)) missPub.push(`${key} → ${label}`)
}
for (const [key, got] of have) {
  const set = wantLabels.get(key)
  if (!set) { extra.push(`${key} (원본에 없는 과목)`); continue }
  for (const label of got) if (!set.has(label)) extra.push(`${key} → ${label}`)
}
const catPairs = [...have.values()].reduce((a, s) => a + s.size, 0)
// 우리가 대표저자를 붙인 줄만 센다 (원본 이름에 괄호가 든 발행사는 빼고)
const rawPubs = new Set()
for (const perPub of want.values()) for (const pub of perPub.keys()) rawPubs.add(pub)
const split = [...wantLabels.values()].reduce((a, s) => a + [...s].filter((x) => !rawPubs.has(x)).length, 0)

console.log(`원본 ${FILES.length}개 파일 · ${rows}행`)
console.log(`기대: 과목 ${wantLabels.size} · 발행사 줄 ${wantPairs} (그중 대표저자를 붙여 나눈 줄 ${split})`)
console.log(`자료: 과목 ${have.size} · 발행사 줄 ${catPairs}`)
console.log(`빠진 과목 ${missSub.length} · 빠진 발행사 줄 ${missPub.length} · 원본에 없는 항목 ${extra.length}`)
for (const x of missSub.slice(0, 20)) console.log('  빠진 과목:', x)
for (const x of missPub.slice(0, 20)) console.log('  빠진 발행사:', x)
for (const x of extra.slice(0, 20)) console.log('  군더더기:', x)
const bad = missSub.length + missPub.length + extra.length
console.log(bad ? `\n❌ 맞지 않는 항목 ${bad}건` : '\n✅ 원본과 자료가 한 줄도 빠짐없이 같습니다')
process.exit(bad ? 1 : 0)
