import { useRef, useState } from 'react'
import { useAppData } from '../store/useAppData'
import { applySettingsFile, buildSettingsFile, parseSettingsFile, settingsFileName, type SettingsFile } from '../lib/settingsFile'
import { download } from '../lib/hwpx'
import { readFileText } from '../lib/csv'

/**
 * 첫 화면의 [설정 JSON] 창.
 * 단위학교가 평가기준·의견 선택지·문서 설정을 파일 하나로 나눠 쓰기 위한 저장·불러오기.
 */
export function SettingsJsonModal({ onClose }: { onClose: () => void }) {
  const { master, saveMaster } = useAppData()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ file: SettingsFile; lines: string[] } | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const save = () => {
    const data = JSON.stringify(buildSettingsFile(master), null, 2)
    download(new Blob([data], { type: 'application/json' }), settingsFileName(master))
    setMsg({ type: 'ok', text: '설정 파일을 내려받았습니다. 이 파일을 다른 선생님께 보내면 됩니다.' })
  }

  const pick = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setMsg(null)
    try {
      const file = parseSettingsFile(await readFileText(f))
      setPending({ file, lines: applySettingsFile(master, file).lines })
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const apply = async () => {
    if (!pending) return
    await saveMaster(applySettingsFile(master, pending.file).master)
    setPending(null)
    setMsg({ type: 'ok', text: '설정을 불러왔습니다. 작성 중인 평가표는 새 기준으로 다시 그려집니다.' })
  }

  const crit = master.criteria.filter((c) => c.subjectId === null)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-json" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="설정 JSON">
        <div className="modal-head">
          <h3>설정 JSON — 학교 안에서 같은 기준으로</h3>
          <button className="btn sm ghost" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="muted small">
            평가기준·의견 선택지·문서 설정(학교명·학년도·목표 점수)과 직접 넣은 과목·출판사를 파일 하나로 저장합니다. 담당 선생님이 저장해 보내고, 다른 선생님은 불러오면 같은 기준으로
            작성할 수 있습니다. <b>작성한 평가표·총괄표는 들어가지 않습니다.</b>
          </p>
          {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

          {pending ? (
            <div className="json-pending">
              <h4>이 파일의 내용으로 바꿉니다</h4>
              <ul className="notice-list">
                {pending.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="muted small">지금 컴퓨터의 평가기준·의견 선택지·문서 설정은 파일 것으로 바뀝니다. 과목·출판사는 없는 것만 더해집니다.</p>
            </div>
          ) : (
            <div className="json-actions">
              <div className="json-card">
                <b>저장하기</b>
                <p className="muted small">
                  지금 설정을 파일로 내려받습니다.
                  <br />
                  기본 평가기준 {crit.length}항목 · 배점 합 {crit.reduce((s, c) => s + c.points, 0)}점
                </p>
                <button className="btn primary" onClick={save}>
                  설정 JSON 저장
                </button>
              </div>
              <div className="json-card">
                <b>불러오기</b>
                <p className="muted small">
                  받은 설정 파일을 골라 이 컴퓨터에 적용합니다.
                  <br />
                  적용 전에 바뀌는 내용을 먼저 보여 줍니다.
                </p>
                <button className="btn" onClick={() => fileRef.current?.click()}>
                  설정 JSON 불러오기
                </button>
                <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => pick(e.target.files)} />
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          {pending ? (
            <>
              <button className="btn" onClick={() => setPending(null)}>
                취소
              </button>
              <button className="btn primary" onClick={apply}>
                이 설정으로 바꾸기
              </button>
            </>
          ) : (
            <button className="btn" onClick={onClose}>
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
