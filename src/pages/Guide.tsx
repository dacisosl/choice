import { useAppData } from '../store/useAppData'

/** 이용 안내 — 역할별 순서 */
export function Guide({ go }: { go: (h: string) => void }) {
  const { master, accountEnabled } = useAppData()
  return (
    <div className="guide" style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="card">
        <h2>이용 안내</h2>
        <p className="muted small">
          {master.settings.year}학년도 검·인정 교과용도서 선정을 위한 서식1(선정 평가표)·서식2(평가 총괄표)·서식3(추천 의견서)을 이 도구로 작성합니다. 로그인 없이 쓰며, 작성한 문서는 각자의 컴퓨터에만 저장됩니다.
        </p>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>교과협의회 위원</h3>
          <ol>
            <li><b>이름·과목</b>을 넣고 검토한 <b>출판사</b>를 적은 뒤 <b>1·2·3순위</b>를 고르면 선정 평가표가 바로 만들어집니다.</li>
            <li>점수 칸을 클릭해 고치고, 맨 아래 <b>종합의견 칸을 클릭</b>하면 열리는 창에서 핵심의견을 고른 뒤 문장을 만듭니다.</li>
            <li>[다음]을 눌러 <b>추천 의견서</b>의 순위별 의견을 같은 방식으로 작성합니다.</li>
            <li>
              마지막 화면에서 <b>[인쇄 / PDF 저장]</b> → 인쇄 창의 대상에서 <b>PDF로 저장</b>을 고릅니다. 평가표는 가로, 추천 의견서는 세로로 함께 출력됩니다.
            </li>
            <li>저장한 PDF를 총괄 작성 선생님께 보냅니다.</li>
          </ol>
          <div className="actions">
            <button className="btn primary" onClick={() => go('personal')}>
              서류 초안 작성하기
            </button>
          </div>
        </div>
        <div className="card">
          <h3>총괄 작성 교사 (교과협의회 대표)</h3>
          <ol>
            <li>작성자 이름과 과목을 넣고, 위원들에게 받은 <b>평가표 PDF를 [+ 추가하기]로 올립니다.</b> 파일에서 위원명·출판사·점수를 읽어 옵니다.</li>
            <li><b>[총괄표 생성하기]</b>를 누르면 평가 총괄표가 집계됩니다.</li>
            <li>표의 숫자를 확인하고, 필요하면 셀을 클릭해 고칩니다. 위원 이름 버튼으로 올린 원본을 볼 수 있습니다.</li>
            <li>같은 화면의 추천 의견서는 순위가 자동으로 매겨지고, 의견 칸을 클릭하면 위원들의 의견을 종합한 문장을 만들 수 있습니다.</li>
            <li>마지막 화면에서 총괄표와 추천 의견서를 한 번에 인쇄하거나 PDF로 저장합니다.</li>
          </ol>
          <div className="actions">
            <button className="btn" onClick={() => go('compile')}>
              평가총괄표 작성
            </button>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>학교 담당(관리) 교사</h3>
        <ol>
          {accountEnabled && (
            <li>
              설정 › <b>담당자 로그인</b>에서 학교를 등록(가입)하고, 정한 <b>학교 아이디</b>를 선생님들께 알려 줍니다.
            </li>
          )}
          <li>설정 › <b>선정 과목 관리</b>에서 올해 선정 대상 과목을 등록합니다. 목록을 붙여넣어 한꺼번에 넣거나 CSV로 올릴 수 있고, 개별 추가·수정·삭제도 됩니다.</li>
          <li>설정 › <b>과목별 출판사 관리</b>에서 과목을 고르고 출판사를 등록합니다. {accountEnabled ? '선생님들 화면에 바로 반영됩니다.' : ''}</li>
          <li>평가기준은 기본 템플릿을 쓰거나 과목 전용으로 만들 수 있습니다. 배점 합계는 100이어야 합니다.</li>
          <li>설정 › 문서·AI 설정에서 문체·목표 총점·AI 키를 조정하고, 설정 파일을 내보내 다른 선생님과 맞출 수 있습니다.</li>
        </ol>
        <div className="actions">
          <button className="btn" onClick={() => go('settings')}>
            설정 열기
          </button>
        </div>
      </div>
    </div>
  )
}
