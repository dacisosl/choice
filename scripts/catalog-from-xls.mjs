#!/usr/bin/env node
/**
 * 교과서 목록 파일 → public/catalog.json
 *
 * 받는 형식 (섞어서 넣어도 된다)
 *  · 진짜 엑셀 (.xls/.xlsx) — 웹전시리스트 등.
 *    열: 순번 | 학교급 | 교과군 | 국,검,인 | 서명1 | 서명2 | 서명3 | 도서 종류 | 저자 | 발행처 | 발행년 | 교육과정
 *  · 확장자만 .xls 인 HTML 표 — 교과서민원바로처리센터 목록 내려받기.
 *    열: 구분 | 학교 | 교과(군) | 도서명 | 발행사 | 저자 | 발행년도 | 교육과정 | …
 *  · .csv / .tsv — 직접 정리한 표. 첫 줄 머리글에 도서명(과목명)과 발행사(출판사)만 있으면 된다.
 *
 * 어느 형식이든 머리글 이름으로 열을 찾으므로 열 순서는 상관없다.
 *
 *   node scripts/catalog-from-xls.mjs 목록.xls                 # 새로 만들기
 *   node scripts/catalog-from-xls.mjs --merge 추가분.csv        # 지금 자료에 더하기
 *   node scripts/catalog-from-xls.mjs --권별 목록.xls           # 중학교도 권(1-1, ①)까지 나눠 두기
 *   node scripts/catalog-from-xls.mjs --지도서 목록.xls          # 교사용 지도서도 넣기
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
let out = 'public/catalog.json'
let merge = false
let keepGuides = false
let perVolume = false
const files = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i]
  else if (args[i] === '--merge') merge = true
  else if (args[i] === '--지도서' || args[i] === '--keep-guides') keepGuides = true
  else if (args[i] === '--권별' || args[i] === '--per-volume') perVolume = true
  else files.push(args[i])
}
if (!files.length) {
  console.error('쓰는 법: node scripts/catalog-from-xls.mjs [--out public/catalog.json] [--merge] [--권별] [--지도서] 목록.xls|목록.csv ...')
  process.exit(1)
}

const clean = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** '중학교' · '중1~2' → { school: '중', gradeGroup: '1·2' } */
function readSchool(raw) {
  const t = clean(raw).replace(/\s/g, '')
  const school = t.startsWith('중') ? '중' : t.startsWith('고') ? '고' : ''
  if (!school) return null
  return { school, gradeGroup: /3/.test(t.slice(1)) ? '3' : '1·2' }
}

/** 가운뎃점·물결 표기가 파일마다 달라 한 가지로 맞춘다 */
const normGroup = (s) => clean(s).replace(/[･·ㆍ⋅]/g, '·').replace(/\s*\/\s*/g, '/')

/** 한 줄을 칸으로 나눈다 (따옴표로 묶인 쉼표도 다룬다) */
function splitLine(line, sep) {
  const cells = []
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
      cells.push(cur)
      cur = ''
    } else cur += ch
  }
  cells.push(cur)
  return cells.map(clean)
}

/** 파일을 [머리글, ...줄] 표로 읽는다 */
function toGrid(file) {
  const buf = readFileSync(file)
  const head = buf.subarray(0, 2048).toString('utf-8')

  if (/\.(csv|tsv|txt)$/i.test(file)) {
    const text = buf.toString('utf-8').replace(/^﻿/, '')
    const first = text.split('\n')[0]
    const sep = /\.tsv$/i.test(file) || first.includes('\t') ? '\t' : ','
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => splitLine(l, sep))
  }

  if (/<tr[\s>]/i.test(head) || /<html/i.test(head)) {
    const text = buf.toString('utf-8')
    const grid = []
    for (const tr of text.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
      const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(clean)
      if (cells.length >= 4) grid.push(cells)
    }
    return grid
  }

  // 진짜 엑셀
  const require = createRequire(import.meta.url)
  let XLSX
  try {
    XLSX = require('xlsx')
  } catch {
    console.error("엑셀(.xls/.xlsx)을 읽으려면 먼저 'npm install' 을 해 주세요.")
    process.exit(1)
  }
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }).map((r) => r.map(clean))
}

/** 머리글에서 원하는 열을 찾는다 */
function findCol(header, keys) {
  for (let i = 0; i < header.length; i++) {
    const h = header[i].replace(/\s|\(|\)|,|·|･|⋅/g, '')
    if (keys.some((k) => h.includes(k))) return i
  }
  return -1
}

function readTable(file) {
  const grid = toGrid(file)
  if (!grid.length) return []
  // 머리글은 '도서명/서명/과목명' 과 '발행사/발행처/출판사' 가 함께 있는 줄
  let headRow = 0
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const h = grid[i]
    if (findCol(h, ['도서명', '서명', '과목명', '교과서명']) >= 0 && findCol(h, ['발행사', '발행처', '출판사']) >= 0) {
      headRow = i
      break
    }
  }
  const header = grid[headRow]
  const ci = {
    school: findCol(header, ['학교']),
    group: findCol(header, ['교과']),
    name: findCol(header, ['도서명', '서명1', '서명', '과목명', '교과서명']),
    vol: findCol(header, ['서명2']),
    pub: findCol(header, ['발행사', '발행처', '출판사']),
    price: findCol(header, ['정가', '가격']),
    kind: findCol(header, ['도서종류']),
  }
  if (ci.name < 0 || ci.pub < 0) {
    console.error(`  ${file}: 머리글에서 '도서명(서명)'과 '발행사(발행처)' 열을 찾지 못했습니다. 읽은 머리글: ${header.join(' | ')}`)
    return []
  }

  const got = []
  for (const row of grid.slice(headRow + 1)) {
    const s = readSchool(ci.school >= 0 ? row[ci.school] : '')
    const base = clean(row[ci.name])
    const vol = ci.vol >= 0 ? clean(row[ci.vol]) : ''
    const publisher = clean(row[ci.pub])
    if (!s || !base || !publisher) continue
    got.push({
      ...s,
      subjectGroup: normGroup(ci.group >= 0 ? row[ci.group] : ''),
      // 고등학교의 '1·2·Ⅰ·Ⅱ' 는 과목명의 일부(공통영어1, 영어Ⅱ)라 붙이고,
      // 중학교의 '1-1·①' 은 책의 권 표시라 붙이지 않는다 (--권별 이면 모두 붙인다)
      name: vol && (perVolume || s.school === '고') ? `${base}${/^[0-9ⅠⅡⅢ]+$/.test(vol) ? '' : ' '}${vol}` : base,
      publisher,
      price: ci.price >= 0 ? clean(row[ci.price]) : '',
      kind: ci.kind >= 0 ? clean(row[ci.kind]) : '',
    })
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
    got = got.filter((r) => !/지도서/.test(r.name) && !/지도서/.test(r.kind))
    guides += before - got.length
  }
  rows.push(...got)
  console.log(`  ${file}: ${got.length} 행`)
}
if (guides) console.log(`  (지도서 ${guides}행은 뺐습니다. 넣으려면 --지도서)`)
if (!rows.length) {
  console.error('표를 찾지 못했습니다. 파일이 교과서 목록이 맞는지 확인해 주세요.')
  process.exit(1)
}

/**
 * 같은 학교급에서 도서명이 같으면 한 과목으로 본다.
 * 같은 책이 해마다·학년 표기만 달리 실려 있어도 목록에 한 번만 나오게 한다.
 * 발행사는 나온 순서대로 모으고 중복은 한 번만 넣는다.
 */
const bySubject = new Map()
const squeeze = (t) => t.replace(/\s|·|･|⋅|ㆍ/g, '').toLowerCase()
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
    (a.subjectGroup || '').localeCompare(b.subjectGroup || '', 'ko') ||
    a.name.localeCompare(b.name, 'ko'),
)

const today = new Date().toISOString().slice(0, 10)
writeFileSync(
  out,
  JSON.stringify({ _설명: '과목별 교과서(출판사) 자료. scripts/catalog-from-xls.mjs 로 교과서 목록에서 만듭니다.', updatedAt: today, subjects }, null, 2) + '\n',
  'utf-8',
)

const pubCount = new Set(subjects.flatMap((s) => s.publishers.map(pubName))).size
console.log(`\n${out} 저장: 과목 ${subjects.length}개${merge ? ` (새로 더한 과목 ${added}개)` : ''} · 발행사 ${pubCount}곳 · 읽은 행 ${rows.length}`)

// 교과별로 몇 개나 들어왔는지 보여 준다. 빠진 교과를 바로 알 수 있다.
for (const sch of ['중', '고']) {
  const mine = subjects.filter((s) => s.school === sch)
  if (!mine.length) continue
  const byGroup = {}
  for (const s of mine) byGroup[s.subjectGroup || '(교과없음)'] = (byGroup[s.subjectGroup || '(교과없음)'] || 0) + 1
  const line = Object.entries(byGroup)
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${g} ${n}`)
    .join(', ')
  console.log(`  ${sch === '중' ? '중학교' : '고등학교'} ${mine.length}과목 — ${line}`)
}
