/**
 * 화면에 있는 서식 중 일부만 골라 인쇄한다.
 * 가로(서식1)와 세로(서식2·3)를 한 번에 섞어 인쇄하면 브라우저에 따라 빈 페이지가 끼거나
 * 축소되는 일이 있어, 방향이 같은 서식끼리 따로 인쇄할 수 있게 한다.
 * @param selector 인쇄할 서식 선택자. 비우면 모든 서식.
 * @param title 인쇄 중 문서 제목. 브라우저 'PDF로 저장' 기본 파일명이 된다.
 */
export function printSheets(selector?: string, title?: string): void {
  const all = Array.from(document.querySelectorAll<HTMLElement>('.form-sheet'))
  const targets = selector ? Array.from(document.querySelectorAll<HTMLElement>(selector)) : all
  if (!targets.length) return
  all.forEach((el) => el.classList.toggle('print-skip', !targets.includes(el)))

  const prevTitle = document.title
  if (title) document.title = title.replace(/[\\/:*?"<>|]/g, ' ').trim()

  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    all.forEach((el) => el.classList.remove('print-skip'))
    document.title = prevTitle
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  // 클래스 반영 후 인쇄 대화상자
  window.setTimeout(() => window.print(), 60)
  // afterprint 가 오지 않는 환경 대비
  window.setTimeout(cleanup, 120000)
}
