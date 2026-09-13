import type { Criterion, DocPublisher, Evaluation, RecommendItem, SummaryMember } from '../types'
import { uid } from '../seed'
import { buildRows, flatten, looksLikeForm1, looksLikeForm3, parseForm1, parseForm3, parseForm3Writer, type ParsedForm1, type TextItem } from './form1Parse'

export interface ImportProgress {
  file: string
  /** 0~1, 알 수 없으면 undefined */
  ratio?: number
  note: string
}

export interface ImportResult {
  members: SummaryMember[]
  errors: { file: string; reason: string }[]
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })()
  }
  return pdfjsPromise
}

/** 평가기준을 못 읽었을 때 총점만으로 표를 만들기 위한 한 줄짜리 기준 */
function totalOnlyCriteria(): Criterion[] {
  return [{ id: 'imported-total', subjectId: null, area: '합계', text: 'PDF에서 읽은 총점', points: 100, locked: false, order: 1 }]
}

function toEvaluation(p: ParsedForm1, recommends: { rank: number; publisherName: string; text: string }[]): Evaluation {
  const publishers: DocPublisher[] = p.publisherNames.map((name) => ({ id: uid(), name }))
  const detailed = p.criteria.length > 0
  const criteria: Criterion[] = detailed
    ? p.criteria.map((c, i) => ({ id: `imported-${i + 1}`, subjectId: null, area: c.area, text: c.text, points: c.points, locked: false, order: i + 1 }))
    : totalOnlyCriteria()

  const scores: Evaluation['scores'] = {}
  publishers.forEach((pub, ci) => {
    scores[pub.id] = {}
    if (detailed) criteria.forEach((c, ri) => (scores[pub.id][c.id] = p.scores[ri]?.[ci] ?? 0))
    else scores[pub.id][criteria[0].id] = p.totals[ci] ?? 0
  })

  // 총점 내림차순으로 순위를 잡아 서식3 재료를 만든다
  const order = publishers.map((pub, i) => ({ id: pub.id, total: p.totals[i] ?? 0 })).sort((a, b) => b.total - a.total)
  const recommend: RecommendItem[] = [1, 2, 3].map((r) => {
    const byName = recommends.find((x) => x.rank === r)
    const matched = byName ? publishers.find((pub) => squeezeName(pub.name) === squeezeName(byName.publisherName)) : undefined
    return {
      rank: r as 1 | 2 | 3,
      pubId: matched?.id || order[r - 1]?.id || null,
      keys: [],
      strength: r === 1 ? '적극 추천' : r === 2 ? '추천' : '대안으로 추천',
      text: byName?.text || '',
    }
  })

  return {
    id: uid(),
    subjectId: '',
    subjectName: p.subjectName,
    teacherName: p.teacherName,
    publishers,
    criteria,
    ranks: recommend.map((r) => r.pubId),
    scores,
    summaryKeys: [],
    summaryOpinion: p.summaryOpinion,
    recommend,
    updatedAt: new Date().toISOString(),
  }
}

export const squeezeName = (s: string) => flatten(s).toLowerCase()

/** PDF 한 쪽의 글자 조각 (텍스트 레이어) */
async function pageItems(page: import('pdfjs-dist').PDFPageProxy): Promise<TextItem[]> {
  const content = await page.getTextContent()
  const out: TextItem[] = []
  for (const raw of content.items) {
    const it = raw as { str?: string; width?: number; transform?: number[] }
    if (typeof it.str !== 'string' || !it.transform) continue
    out.push({ x: it.transform[4], y: it.transform[5], w: it.width || 0, str: it.str })
  }
  return out
}

/** 글자가 없는 쪽(스캔본)을 그림으로 읽는다 */
async function ocrPage(page: import('pdfjs-dist').PDFPageProxy, onProgress: (ratio: number) => void): Promise<TextItem[]> {
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다.')
  await page.render({ canvas, canvasContext: ctx, viewport } as never).promise

  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('kor+eng', 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') onProgress(m.progress)
    },
  })
  try {
    const res = await worker.recognize(canvas, {}, { blocks: true })
    const items: TextItem[] = []
    type Box = { x0: number; y0: number; x1: number; y1: number }
    type Word = { text?: string; bbox?: Box }
    type Line = { words?: Word[]; text?: string; bbox?: Box }
    type Para = { lines?: Line[] }
    type Block = { paragraphs?: Para[] }
    const blocks = (res.data as unknown as { blocks?: Block[] }).blocks || []
    for (const b of blocks) {
      for (const para of b.paragraphs || []) {
        for (const line of para.lines || []) {
          const words = line.words || []
          if (words.length) {
            for (const w of words) {
              if (!w.text || !w.bbox) continue
              // OCR 좌표는 위에서 아래로 커지므로 부호를 뒤집어 PDF 좌표계에 맞춘다
              items.push({ x: w.bbox.x0, y: -w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, str: w.text })
            }
          } else if (line.text && line.bbox) {
            items.push({ x: line.bbox.x0, y: -line.bbox.y0, w: line.bbox.x1 - line.bbox.x0, str: line.text })
          }
        }
      }
    }
    if (!items.length) throw new Error('글자를 찾지 못했습니다.')
    return items
  } finally {
    await worker.terminate()
  }
}

/**
 * PDF 한 개를 처음부터 끝까지 훑어 평가표를 모두 찾는다.
 * · 서식1(선정 평가표)이 나올 때마다 위원 한 명으로 친다 → 여러 위원 표를 한 파일로 묶어 올려도 된다.
 * · 그 뒤에 나오는 추천 의견서는 바로 앞 위원의 것으로 붙인다.
 * · 빈 페이지나 읽히지 않는 페이지는 건너뛴다 (앞에 빈 장이 끼어 있어도 나머지는 읽는다).
 */
type Recommend = { rank: number; publisherName: string; text: string }
type Orphan = { teacherName: string; recommends: Recommend[] }

async function readPdf(file: File, onProgress: (p: ImportProgress) => void): Promise<{ members: SummaryMember[]; orphans: Orphan[] } | { error: string }> {
  const pdfjs = await getPdfjs()
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise

  type Found = { parsed: ParsedForm1; recommends: Recommend[]; ocr: boolean }
  const found: Found[] = []
  /** 앞에 평가표가 없는 추천 의견서 — 이름이 같은 위원에게 나중에 붙인다 */
  const orphans: Orphan[] = []
  const skipped: number[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    onProgress({ file: file.name, note: `${i}/${doc.numPages}쪽 읽는 중…`, ratio: (i - 1) / doc.numPages })
    let items: TextItem[] = []
    let usedOcr = false
    try {
      items = await pageItems(page)
    } catch {
      items = []
    }
    if (items.length < 5) {
      // 글자 정보가 없으면 그림에서 읽어 본다. 빈 장이면 여기서도 안 나오므로 건너뛴다.
      try {
        onProgress({ file: file.name, note: `${i}쪽은 글자 정보가 없어 그림에서 읽습니다 (시간이 걸립니다)…`, ratio: (i - 1) / doc.numPages })
        items = await ocrPage(page, (r) => onProgress({ file: file.name, note: `${i}쪽 그림에서 글자 읽는 중 ${Math.round(r * 100)}%`, ratio: (i - 1 + r) / doc.numPages }))
        usedOcr = true
      } catch {
        items = []
      }
    }
    if (items.length < 5) {
      skipped.push(i)
      continue
    }
    const rows = buildRows(items)
    const one = looksLikeForm1(rows) ? parseForm1(rows) : null
    if (one) found.push({ parsed: one, recommends: [], ocr: usedOcr })
    else if (looksLikeForm3(rows)) {
      const recs = parseForm3(rows)
      if (found.length) {
        const last = found[found.length - 1]
        last.recommends.push(...recs)
        if (usedOcr) last.ocr = true
      } else if (recs.length) orphans.push({ teacherName: parseForm3Writer(rows), recommends: recs })
    }
  }

  if (!found.length) {
    if (orphans.length) return { members: [], orphans }
    const why = skipped.length === doc.numPages ? '글자를 읽지 못했습니다.' : '선정 평가표를 찾지 못했습니다.'
    return { error: `${why} 위원이 [평가표 인쇄·PDF]로 만든 파일인지 확인해 주세요.` }
  }

  const base = file.name.replace(/\.pdf$/i, '')
  const members = found.map((f, idx) => {
    const evaluation = toEvaluation(f.parsed, f.recommends)
    if (!evaluation.teacherName) evaluation.teacherName = found.length > 1 ? `${base} (${idx + 1})` : base
    const warnings = [...f.parsed.warnings]
    if (f.ocr) warnings.unshift('스캔본에서 읽었습니다. 숫자가 맞는지 꼭 확인하세요.')
    if (skipped.length) warnings.push(`${skipped.join(', ')}쪽은 글자가 없어 건너뛰었습니다.`)
    return {
      id: uid(),
      teacherName: evaluation.teacherName,
      source: f.ocr ? ('pdf-ocr' as const) : ('pdf' as const),
      evaluation,
      warnings,
    }
  })
  return { members, orphans }
}

/** 따로 올라온 추천 의견서를 평가표(위원)에 붙인다 */
function attachRecommends(member: SummaryMember, recs: Recommend[]): void {
  const ev = member.evaluation
  if (!ev) return
  ev.recommend = ev.recommend.map((r) => {
    const hit = recs.find((x) => x.rank === r.rank)
    if (!hit) return r
    const pub = ev.publishers.find((p) => squeezeName(p.name) === squeezeName(hit.publisherName))
    return { ...r, pubId: pub?.id || r.pubId, text: hit.text || r.text }
  })
  ev.ranks = ev.recommend.map((r) => r.pubId)
}

/** 위원들이 보낸 평가표 PDF 를 읽어 총괄표의 위원 열로 만든다 */
export async function importMemberFiles(files: File[], onProgress: (p: ImportProgress) => void, existing?: SummaryMember[]): Promise<ImportResult> {
  const members: SummaryMember[] = []
  const errors: { file: string; reason: string }[] = []
  const pending: { file: string; orphan: Orphan }[] = []
  for (const file of files) {
    try {
      onProgress({ file: file.name, note: '읽는 중…' })
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        errors.push({ file: file.name, reason: '평가표 PDF 파일만 올릴 수 있습니다.' })
        continue
      }
      const res = await readPdf(file, onProgress)
      if ('error' in res) errors.push({ file: file.name, reason: res.error })
      else {
        members.push(...res.members)
        for (const o of res.orphans) pending.push({ file: file.name, orphan: o })
      }
    } catch (e) {
      errors.push({ file: file.name, reason: (e as Error).message })
    }
  }
  // 의견서만 따로 온 파일은 이름이 같은 위원에게 붙인다 (이 묶음에 있는 위원과 이미 올린 위원 모두)
  for (const { file, orphan } of pending) {
    const key = squeezeName(orphan.teacherName)
    const target = key ? [...members, ...(existing || [])].find((m) => squeezeName(m.teacherName) === key) : undefined
    if (target) attachRecommends(target, orphan.recommends)
    else {
      errors.push({
        file,
        reason: orphan.teacherName
          ? `추천 의견서만 있는 파일입니다. '${orphan.teacherName}' 위원의 평가표를 함께 올리면 붙여 드립니다.`
          : '추천 의견서만 있는 파일입니다. 같은 위원의 평가표를 함께 올려 주세요.',
      })
    }
  }
  return { members, errors }
}
