#!/usr/bin/env node
/**
 * 교과서 목록 엑셀(.xls) → public/catalog.json
 *
 * 교과서민원바로처리센터 등에서 내려받은 '교과서목록' 파일은 확장자만 .xls 이고
 * 실제로는 표가 들어 있는 HTML 문서다. 그 표에서 학교·교과(군)·도서명·발행사를 읽어
 * 앱이 쓰는 자료 파일로 바꾼다.
 *
 *   node scripts/catalog-from-xls.mjs 파일1.xls 파일2.xls ...
 *   node scripts/catalog-from-xls.mjs --out public/catalog.json 파일*.xls
 *
 * 표의 열: 구분 | 학교 | 교과(군) | 도서명 | 발행사 | 저자 | 발행년도 | 교육과정 | …
 */
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
let out = 'public/catalog.json'
const files = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i]
  else files.push(args[i])
}
if (!files.length) {
  console.error('쓰는 법: node scripts/catalog-from-xls.mjs [--out public/catalog.json] 교과서목록*.xls')
  process.exit(1)
}

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/** '중1~2' → { school: '중', gradeGroup: '1·2' } */
function readSchool(raw) {
  const t = raw.replace(/\s/g, '')
  const school = t.startsWith('중') ? '중' : t.startsWith('고') ? '고' : ''
  if (!school) return null
  return { school, gradeGroup: /3/.test(t.slice(1)) ? '3' : '1·2' }
}

/** 가운뎃점·물결 표기가 파일마다 달라 한 가지로 맞춘다 */
const normGroup = (s) => s.replace(/[･·ㆍ]/g, '·').replace(/\s*\/\s*/g, '/').trim()

const rows = []
for (const file of files) {
  const html = readFileSync(file, 'utf-8')
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(strip)
    if (cells.length < 5) continue
    const [, schoolRaw, groupRaw, name, publisher] = cells
    const s = readSchool(schoolRaw)
    if (!s || !name || !publisher) continue
    rows.push({ ...s, subjectGroup: normGroup(groupRaw), name, publisher })
  }
  console.log(`  ${file}: ${rows.length} 행까지 읽음`)
}
if (!rows.length) {
  console.error('표를 찾지 못했습니다. 파일이 교과서목록 엑셀이 맞는지 확인해 주세요.')
  process.exit(1)
}

/** 같은 (학교·학년군·교과·도서명) 은 한 과목, 발행사는 나온 순서대로 모은다 */
const bySubject = new Map()
for (const r of rows) {
  const key = `${r.school}|${r.gradeGroup}|${r.subjectGroup}|${r.name}`
  if (!bySubject.has(key)) bySubject.set(key, { school: r.school, gradeGroup: r.gradeGroup, subjectGroup: r.subjectGroup, name: r.name, publishers: [] })
  const s = bySubject.get(key)
  if (!s.publishers.includes(r.publisher)) s.publishers.push(r.publisher)
}

const order = { 중: 0, 고: 1 }
const subjects = [...bySubject.values()].sort(
  (a, b) =>
    order[a.school] - order[b.school] ||
    a.gradeGroup.localeCompare(b.gradeGroup, 'ko') ||
    a.subjectGroup.localeCompare(b.subjectGroup, 'ko') ||
    a.name.localeCompare(b.name, 'ko'),
)

const today = new Date().toISOString().slice(0, 10)
const catalog = {
  _설명: '과목별 교과서(출판사) 자료. scripts/catalog-from-xls.mjs 로 교과서목록 엑셀에서 만듭니다.',
  updatedAt: today,
  subjects,
}
writeFileSync(out, JSON.stringify(catalog, null, 2) + '\n', 'utf-8')

const pubCount = new Set(rows.map((r) => r.publisher)).size
const per = {}
for (const s of subjects) per[`${s.school}${s.gradeGroup}`] = (per[`${s.school}${s.gradeGroup}`] || 0) + 1
console.log(`\n${out} 저장: 과목 ${subjects.length}개 · 발행사 ${pubCount}곳 · 원본 ${rows.length}행`)
console.log('학교·학년군별 과목 수:', per)
