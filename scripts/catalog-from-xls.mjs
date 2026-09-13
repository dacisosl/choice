#!/usr/bin/env node
/**
 * 교과서 목록 파일(.xls/.csv/.tsv) → public/catalog.json
 *
 * · .xls : 교과서민원바로처리센터 등에서 내려받은 '교과서목록'. 확장자만 .xls 이고
 *          실제로는 표가 든 HTML 문서다. 열은 구분 | 학교 | 교과(군) | 도서명 | 발행사 | …
 * · .csv/.tsv : 직접 정리한 표. 첫 줄에 머리글이 있어야 하며
 *          학교 / 교과(군) / 도서명(과목명) / 발행사(출판사) 네 가지를 찾아 쓴다.
 *          (열 순서는 상관없고, 정가 열이 있으면 함께 넣는다)
 *
 *   node scripts/catalog-from-xls.mjs 교과서목록*.xls          # 새로 만들기
 *   node scripts/catalog-from-xls.mjs --merge 추가분.csv        # 지금 자료에 더하기
 *   node scripts/catalog-from-xls.mjs --out public/catalog.json --merge 파일들...
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
let out = 'public/catalog.json'
let merge = false
let keepGuides = false
const files = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i]
  else if (args[i] === '--merge') merge = true
  else if (args[i] === '--지도서' || args[i] === '--keep-guides') keepGuides = true
  else files.push(args[i])
}
if (!files.length) {
  console.error('쓰는 법: node scripts/catalog-from-xls.mjs [--out public/catalog.json] [--merge] [--지도서] 교과서목록*.xls|추가분.csv')
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

/** 한 줄을 칸으로 나눈다 (따옴표로 묶인 쉼표도 다룬다) */
function splitLine(line, sep) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (ch === sep && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

/** 머리글에서 원하는 열을 찾는다 */
function findCol(head, keys) {
  for (let i = 0; i < head.length; i++) {
    const h = head[i].replace(/\s|\(|\)|·|･/g, '')
    if (keys.some((k) => h.includes(k))) return i
  }
  return -1
}

function readTable(file) {
  const text = readFileSync(file, 'utf-8').replace(/^\uFEFF/, '')
  const got = []
  if (/\.(csv|tsv|txt)$/i.test(file)) {
    const sep = /\.tsv$/i.test(file) ? '\t' : text.split('\n')[0].includes('\t') ? '\t' : ','
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (!lines.length) return got
    const head = splitLine(lines[0], sep)
    const ci = {
      school: findCol(head, ['학교', '학교급']),
      group: findCol(head, ['교과']),
      name: findCol(head, ['도서명', '과목명', '과목', '교과서']),
      pub: findCol(head, ['발행사', '출판사']),
      price: findCol(head, ['정가', '가격']),
    }
    if (ci.name < 0 || ci.pub < 0) {
      console.error(`  ${file}: 머리글에서 '도서명(과목명)'과 '발행사(출판사)' 열을 찾지 못했습니다. 읽은 머리글: ${head.join(' | ')}`)
      return got
    }
    for (const line of lines.slice(1)) {
      const c = splitLine(line, sep)
      const s = readSchool(ci.school >= 0 ? c[ci.school] || '' : '')
      const name = (c[ci.name] || '').trim()
      const publisher = (c[ci.pub] || '').trim()
      if (!s || !name || !publisher) continue
      got.push({ ...s, subjectGroup: normGroup(ci.group >= 0 ? c[ci.group] || '' : ''), name, publisher, price: ci.price >= 0 ? (c[ci.price] || '').trim() : '' })
    }
    return got
  }
  for (const tr of text.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(strip)
    if (cells.length < 5) continue
    const [, schoolRaw, groupRaw, name, publisher] = cells
    const s = readSchool(schoolRaw)
    if (!s || !name || !publisher) continue
    got.push({ ...s, subjectGroup: normGroup(groupRaw), name, publisher, price: '' })
  }
  return got
}

const rows = []
let guides = 0
for (const file of files) {
  let got = readTable(file)
  if (!keepGuides) {
    const before = got.length
    // 교사용 지도서는 선정 대상이 아니라 목록만 어지럽힌다 (--지도서 로 넣을 수 있다)
    got = got.filter((r) => !/지도서/.test(r.name))
    guides += before - got.length
  }
  rows.push(...got)
  console.log(`  ${file}: ${got.length} 행`)
}
if (guides) console.log(`  (지도서 ${guides}행은 뺐습니다. 넣으려면 --지도서)`)
if (!rows.length) {
  console.error('표를 찾지 못했습니다. 파일이 교과서목록 엑셀이 맞는지 확인해 주세요.')
  process.exit(1)
}

/**
 * 같은 학교급에서 도서명이 같으면 한 과목으로 본다.
 * 같은 책이 해마다·학년 표기(중1~2 / 중1~3)만 달리 실려 있어 그대로 두면 목록에 여러 번 나온다.
 * 발행사는 나온 순서대로 모으고 중복은 한 번만 넣는다.
 */
const bySubject = new Map()
const squeeze = (t) => t.replace(/\s|·|･|ㆍ/g, '').toLowerCase()
const keyOf = (s) => `${s.school}|${squeeze(s.name)}`
const pubName = (p) => (typeof p === 'string' ? p : p?.name || '')

if (merge && existsSync(out)) {
  const prev = JSON.parse(readFileSync(out, 'utf-8'))
  for (const s of prev.subjects || []) {
    bySubject.set(keyOf(s), { school: s.school, gradeGroup: s.gradeGroup, subjectGroup: s.subjectGroup, name: s.name, publishers: [...(s.publishers || [])] })
  }
  console.log(`  (병합) 지금 자료의 과목 ${bySubject.size}개를 그대로 두고 더합니다`)
}

let added = 0
for (const r of rows) {
  const key = keyOf(r)
  if (!bySubject.has(key)) {
    bySubject.set(key, { school: r.school, gradeGroup: r.gradeGroup, subjectGroup: r.subjectGroup, name: r.name, publishers: [] })
    added++
  }
  const s = bySubject.get(key)
  if (!s.subjectGroup && r.subjectGroup) s.subjectGroup = r.subjectGroup
  if (!s.publishers.some((p) => pubName(p) === r.publisher)) s.publishers.push(r.price ? { name: r.publisher, price: r.price } : r.publisher)
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

const pubCount = new Set(subjects.flatMap((s) => s.publishers.map(pubName))).size
const per = {}
for (const s of subjects) per[`${s.school}${s.gradeGroup}`] = (per[`${s.school}${s.gradeGroup}`] || 0) + 1
console.log(`\n${out} 저장: 과목 ${subjects.length}개${merge ? ` (새로 더한 과목 ${added}개)` : ''} · 발행사 ${pubCount}곳 · 읽은 행 ${rows.length}`)
console.log('학교·학년군별 과목 수:', per)
