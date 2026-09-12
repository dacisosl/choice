import type { ReactNode } from 'react'

interface Props {
  title: string
  /** warn = 고칠 수 없다는 안내, info = 한 번 더 확인해 달라는 안내 */
  tone?: 'warn' | 'info'
  children: ReactNode
  /** 주면 오른쪽에 실행 버튼이 생긴다 */
  confirmLabel?: string
  onConfirm?: () => void
  cancelLabel?: string
  onClose: () => void
}

/** 작은 안내 창. 점수 수정 제한 안내와 인쇄 전 확인에 함께 쓴다 */
export function NoticeModal({ title, tone = 'warn', children, confirmLabel, onConfirm, cancelLabel = '닫기', onClose }: Props) {
  return (
    <div className="modal-backdrop no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal notice-modal ${tone}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <span className="notice-icon" aria-hidden="true">
            {tone === 'warn' ? '!' : '?'}
          </span>
          <h3>{title}</h3>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            {cancelLabel}
          </button>
          {confirmLabel && (
            <button className="btn primary" onClick={onConfirm}>
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
