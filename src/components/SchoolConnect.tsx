import { useEffect, useState } from 'react'
import { useAppData } from '../store/useAppData'
import { lsGet, lsSet } from '../store/storage'

const SKIP_KEY = 'choice.skipSchool'

/**
 * 작성 화면에 들어오면 학교 아이디를 먼저 묻는다.
 * 한 번 연결하거나 '없이 이용하기'를 고르면 이 컴퓨터에 기억해 다시 묻지 않는다.
 */
export function SchoolConnect() {
  const { accountEnabled, schoolStatus, schoolId, attachSchool, busy, authError, clearAuthError } = useAppData()
  const [ask, setAsk] = useState(false)
  const [id, setId] = useState('')

  // 아직 연결한 적도, 건너뛴 적도 없으면 들어오자마자 묻는다
  useEffect(() => {
    if (!accountEnabled) return
    if (schoolStatus === 'ok' || schoolStatus === 'loading') return
    if (lsGet<boolean>(SKIP_KEY, false)) return
    setAsk(true)
  }, [accountEnabled, schoolStatus])

  if (!accountEnabled || schoolStatus === 'ok') return null

  const connect = async () => {
    if (!id.trim()) return
    const ok = await attachSchool(id)
    if (ok) setAsk(false)
  }

  const skip = () => {
    lsSet(SKIP_KEY, true)
    clearAuthError()
    setAsk(false)
  }

  return (
    <>
      <div className="card side-card school-tip">
        <b>로그인 없이도 작성할 수 있어요.</b>
        <p>학교 아이디를 넣으면 과목과 출판사가 자동으로 채워져 훨씬 손쉽게 작성할 수 있습니다.</p>
        <button className="btn sm" onClick={() => setAsk(true)}>
          학교 아이디 연결하기
        </button>
      </div>

      {ask && (
        <div className="modal-backdrop no-print" onMouseDown={(e) => e.target === e.currentTarget && skip()}>
          <div className="modal school-modal" role="dialog" aria-modal="true" aria-label="학교 아이디 입력">
            <div className="modal-body">
              <h3 className="school-modal-title">학교 아이디를 입력하세요</h3>
              <p className="muted small">
                담당 선생님께 받은 아이디를 넣으면 우리 학교의 <b>선정 과목</b>과 <b>과목별 출판사</b>가 자동으로 채워집니다. 한 번 넣으면 이 컴퓨터에 기억되어 다시 묻지 않습니다.
              </p>
              <input
                type="text"
                className="school-input"
                value={id}
                autoFocus
                placeholder="예: haemil-high"
                onChange={(e) => setId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && connect()}
              />
              {schoolStatus === 'missing' && schoolId && !authError && (
                <div className="alert warn" style={{ marginTop: 12 }}>
                  ‘{schoolId}’ 아이디를 찾지 못했습니다. 다시 확인해 주세요.
                </div>
              )}
              {authError && <div className="alert error" style={{ marginTop: 12 }}>{authError}</div>}
              <button className="btn primary lg school-go" onClick={connect} disabled={busy || !id.trim()}>
                {busy ? '확인 중…' : '연결하기'}
              </button>
              <button className="linklike school-skip" onClick={skip}>
                학교 아이디 없이 이용하기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
