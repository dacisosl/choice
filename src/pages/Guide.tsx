import { useAppData } from '../store/useAppData'
import { useAuth } from '../store/auth'

/** 이용 안내 — 역할별 순서 */
export function Guide({ go }: { go: (h: string) => void }) {
  const { master } = useAppData()
  const { enabled } = useAuth()
  return (
    <div className="guide" style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="card">
        <h2>이용 안내</h2>
        <p className="muted small">
          {master.settings.year}학년도 검·인정 교과용도서 선정을 위한 서식1(선정 평가표)·서식2(평가 총괄표)·서식3(추천 의견서)을 이 도구로 작성합니다.
        </p>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>교과협의회 위원</h3>
          <ol>
            <li>
              {enabled ? <b>구글 로그인</b> : <b>접속 코드 입력</b>} 후 서류 초안 작성을 시작합니다.
            </li>
            <li>
              <b>과목</b>과 <b>1·2·3순위 출판사</b>를 고르면 서식1 점수표가 자동으로 채워집니다.
            </li>
            <li>점수 칸을 클릭해 수정하고, 핵심의견을 체크한 뒤 <b>의견 생성</b>으로 종합의견 문장을 만듭니다.</li>
            <li>순위별 추천의견(서식3형)을 같은 방식으로 작성합니다.</li>
            <li>
              미리보기에서 확인하고 <b>제출</b>합니다. 총괄표가 만들어지기 전까지는 제출을 취소할 수 있습니다.
            </li>
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
            <li>과목을 선택해 위원별 <b>제출 현황</b>을 확인합니다. 3인 미만이면 경고가 표시됩니다.</li>
            <li>작성자·확인자를 입력하고 <b>총괄표 생성</b>을 누르면 서식2가 자동 집계됩니다.</li>
            <li>공식 서식3의 순위는 평균으로 자동 산출되고, 위원 의견을 종합한 문장을 생성할 수 있습니다.</li>
            <li>
              <b>제출(확정)</b>하면 과목이 마감되어 위원의 수정이 차단됩니다. 서식2·3을 한 번에 인쇄합니다.
            </li>
          </ol>
          <div className="actions">
            <button className="btn" onClick={() => go('compile')}>
              평가총괄표 작성
            </button>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>담당(관리) 교사</h3>
        <ol>
          <li>관리 › 과목·출판사에서 과목별 출판사를 입력합니다. CSV 업로드와 서식 내려받기를 지원합니다.</li>
          <li>평가기준은 기본 템플릿을 쓰거나 과목 전용으로 만들 수 있습니다. 배점 합계는 100이어야 하며 가격·재정 항목은 삭제할 수 없습니다.</li>
          {enabled && <li>회원 관리에서 로그인한 교사를 승인하고, 필요하면 관리자로 지정합니다.</li>}
          <li>제출 관리에서 제출본·총괄표를 확인하고 제출 취소, 확정 취소, 삭제, 내려받기를 할 수 있습니다.</li>
          <li>설정에서 문체, 순위별 목표 총점, AI 모델을 조정하고 백업을 내려받습니다.</li>
        </ol>
        <div className="actions">
          <button className="btn" onClick={() => go('admin')}>
            관리 열기
          </button>
        </div>
      </div>
    </div>
  )
}
