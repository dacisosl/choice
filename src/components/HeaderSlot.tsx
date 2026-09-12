import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 상단바 가운데 자리에 내용을 끼워 넣는다 (단계 표시 등) */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setEl(document.getElementById('topbar-slot'))
  }, [])
  return el ? createPortal(children, el) : null
}
