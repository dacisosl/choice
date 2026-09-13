import type { Criterion, DocPublisher, Evaluation, RecommendItem, SummaryMember } from '../types'
import { uid } from '../seed'
import { buildRows, flatten, looksLikeForm1, looksLikeForm3, parseForm1, parseForm3, type ParsedForm1, type TextItem } from './form1Parse'

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

async function readPdf(file: File, onProgress: (p: ImportProgress) => void): Promise<{ member: SummaryMember } | { error: string }> {
  const pdfjs = await getPdfjs()
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  let parsed: ParsedForm1 | null = null
  let usedOcr = false
  const recommends: { rank: number; publisherName: string; text: string }[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    onProgress({ file: file.name, note: `${i}/${doc.numPages}쪽 읽는 중…`, ratio: (i - 1) / doc.numPages })
    let items = await pageItems(page)
    if (items.length < 5) {
      onProgress({ file: file.name, note: `${i}쪽은 글자 정보가 없어 그림에서 읽습니다 (시간이 걸립니다)…`, ratio: (i - 1) / doc.numPages })
      items = await ocrPage(page, (r) => onProgress({ file: file.name, note: `${i}쪽 그림에서 글자 읽는 중 ${Math.round(r * 100)}%`, ratio: (i - 1 + r) / doc.numPages }))
      usedOcr = true
    }
    const rows = buildRows(items)
    if (!parsed && looksLikeForm1(rows)) parsed = parseForm1(rows)
    else if (looksLikeForm3(rows)) recommends.push(...parseForm3(rows))
  }

  if (!parsed) return { error: '서식1(선정 평가표)을 찾지 못했습니다. 위원이 [서식1 인쇄·PDF 저장]으로 만든 파일인지 확인해 주세요.' }

  const evaluation = toEvaluation(parsed, recommends)
  if (!evaluation.teacherName) evaluation.teacherName = file.name.replace(/\.pdf$/i, '')
  return {
    member: {
      id: uid(),
      teacherName: evaluation.teacherName,
      source: usedOcr ? 'pdf-ocr' : 'pdf',
      evaluation,
      warnings: usedOcr ? ['스캔본에서 읽었습니다. 숫자가 맞는지 꼭 확인하세요.', ...parsed.warnings] : parsed.warnings,
    },
  }
}

/** 위원들이 보낸 평가표 PDF 를 읽어 총괄표의 위원 열로 만든다 */
export async function importMemberFiles(files: File[], onProgress: (p: ImportProgress) => void): Promise<ImportResult> {
  const members: SummaryMember[] = []
  const errors: { file: string; reason: string }[] = []
  for (const file of files) {
    try {
      onProgress({ file: file.name, note: '읽는 중…' })
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        errors.push({ file: file.name, reason: '평가표 PDF 파일만 올릴 수 있습니다.' })
        continue
      }
      const res = await readPdf(file, onProgress)
      if ('error' in res) errors.push({ file: file.name, reason: res.error })
      else members.push(res.member)
    } catch (e) {
      errors.push({ file: file.name, reason: (e as Error).message })
    }
  }
  return { members, errors }
}
