import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 아래쪽으로 남겨 둘 여백 */
  bottomGap?: number
  /** 이 배율보다 더 작게는 줄이지 않는다 */
  minScale?: number
  /** false 면 폭에만 맞춘다 (여러 장을 이어 보는 검토 화면용: 페이지가 스크롤된다) */
  fitHeight?: boolean
}

/**
 * 서식(A4 크기 고정)을 화면에 맞춰 줄여 보여 준다.
 * 원래 크기는 그대로 두고 보이는 크기만 줄이므로 인쇄 결과는 달라지지 않는다.
 */
export function SheetFit({ children, bottomGap = 68, minScale = 0.62, fitHeight = true }: Props) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [boxH, setBoxH] = useState<number | undefined>(undefined)
  const [innerScroll, setInnerScroll] = useState(false)

  const fit = useCallback(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    // transform 은 offsetWidth/Height 에 영향을 주지 않으므로 원래 크기를 그대로 읽을 수 있다
    const natW = i.offsetWidth
    const natH = i.offsetHeight
    if (!natW || !natH) return
    const availW = o.clientWidth
    const availH = window.innerHeight - o.getBoundingClientRect().top - bottomGap
    const next = Math.max(minScale, Math.min(1, availW / natW, fitHeight ? availH / natH : Number.POSITIVE_INFINITY))
    setScale(next)
    const wanted = natH * next
    if (!fitHeight) {
      // 높이는 줄인 만큼만 차지하고, 넘치면 페이지를 스크롤한다
      setBoxH(wanted)
      setInnerScroll(false)
      return
    }
    // 너무 작아지지 않게 줄인 뒤에도 남으면, 페이지 대신 이 영역만 스크롤한다
    setBoxH(Math.min(wanted, Math.max(240, availH)))
    setInnerScroll(wanted > availH + 1)
  }, [bottomGap, minScale, fitHeight])

  useLayoutEffect(fit, [fit, children])

  useEffect(() => {
    const i = inner.current
    if (!i) return
    const ro = new ResizeObserver(fit)
    ro.observe(i)
    window.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [fit])

  return (
    <div className={`sheet-fit ${innerScroll ? 'scrolls' : ''}`} ref={outer} style={{ height: boxH }}>
      <div className="sheet-fit-inner" ref={inner} style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}
