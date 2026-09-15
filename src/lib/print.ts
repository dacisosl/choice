/**
 * 화면에 있는 서식 중 일부만 골라 인쇄한다.
 * 가로(서식1)와 세로(서식2·3)를 한 번에 섞어 인쇄하면 브라우저에 따라 빈 페이지가 끼거나
 * 축소되는 일이 있어, 방향이 같은 서식끼리 따로 인쇄한다.
 */

export interface PrintJob {
  /** 인쇄할 서식 선택자 */
  selector: string
  /** 인쇄 중 문서 제목. 브라우저 'PDF로 저장' 기본 파일명이 된다 */
  title: string
}

function printOne(selector?: string, title?: string): Promise<void> {
  return new Promise((resolve) => {
    const all = Array.from(document.querySelectorAll<HTMLElement>('.form-sheet'))
    const targets = selector ? Array.from(document.querySelectorAll<HTMLElement>(selector)) : all
    if (!targets.length) return resolve()
    all.forEach((el) => el.classList.toggle('print-skip', !targets.includes(el)))

    const prevTitle = document.title
    if (title) document.title = title.replace(/[\\/:*?"<>|]/g, ' ').trim()

    // 종이 방향은 이 서식 하나에 맞춰 문서 전체에 건다.
    // 한 문서 안에서 세로·가로 페이지를 이름으로 섞으면(@page landscape) 브라우저에 따라
    // 첫 장에 빈 세로 페이지가 끼어 나오므로, 서식마다 따로 인쇄하는 지금은 기본 페이지 하나만 쓴다.
    const landscape = targets.some((el) => el.classList.contains('landscape'))
    const pageStyle = document.createElement('style')
    pageStyle.id = 'print-page-size'
    pageStyle.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: ${landscape ? '10mm' : '12mm'}; }`
    document.head.appendChild(pageStyle)
    document.documentElement.classList.add('printing')

    let done = false
    let guard = 0
    const cleanup = () => {
      if (done) return
      done = true
      all.forEach((el) => el.classList.remove('print-skip'))
      pageStyle.remove()
      document.documentElement.classList.remove('printing')
      document.title = prevTitle
      window.removeEventListener('afterprint', cleanup)
      window.clearTimeout(guard)
      resolve()
    }
    window.addEventListener('afterprint', cleanup)
    // afterprint 가 오지 않는 환경 대비
    guard = window.setTimeout(cleanup, 120000)
    // 클래스 반영 후 인쇄 대화상자
    window.setTimeout(() => window.print(), 60)
  })
}

/** 서식 하나만 인쇄한다 */
export function printSheets(selector?: string, title?: string): void {
  void printOne(selector, title)
}

/**
 * 서식을 하나씩 차례로 인쇄한다.
 * 앞 서식의 인쇄 창을 닫으면 다음 서식의 인쇄 창이 이어서 열려,
 * 단추 하나로 평가표 파일과 추천 의견서 파일을 각각 저장할 수 있다.
 */
export async function printSheetsInTurn(jobs: PrintJob[]): Promise<void> {
  for (const job of jobs) {
    await printOne(job.selector, job.title)
    // 인쇄 창이 겹쳐 열리지 않도록 잠깐 쉰다
    await new Promise((r) => window.setTimeout(r, 350))
  }
}
