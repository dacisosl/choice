import { useAppData } from '../store/useAppData'

/** 개인정보 처리방침 — 학교 담당자 계정 가입 시 동의 대상 */
export function Privacy({ go }: { go: (h: string) => void }) {
  const { master } = useAppData()
  return (
    <div className="guide" style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="card">
        <h2>개인정보 처리방침</h2>
        <p className="muted small">선정초안작성기(이하 ‘이 서비스’)는 교과용도서 선정 서류 작성을 돕는 도구입니다. 아래와 같이 최소한의 정보만 다룹니다.</p>

        <h3>1. 서버에 저장하지 않는 것</h3>
        <p>
          위원별 평가 점수, 종합의견·추천의견, 총괄표 등 <b>선정 심사와 관련한 모든 문서는 서버로 전송되지 않습니다.</b> 각자의 컴퓨터(브라우저 저장소)에만 남고, 인쇄·PDF·파일 저장으로만 밖으로 나갑니다. 브라우저 저장 자료를 지우면 함께 사라집니다.
        </p>

        <h3>2. 수집하는 개인정보</h3>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 150 }}>항목</th>
              <th>목적</th>
              <th style={{ width: 120 }}>보유 기간</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>이메일 주소</td>
              <td>학교 담당자 계정 로그인, 비밀번호 재설정 안내</td>
              <td>탈퇴 시 즉시 삭제</td>
            </tr>
            <tr>
              <td>비밀번호</td>
              <td>계정 인증 (암호화되어 인증 서비스에 보관되며 운영자도 원문을 볼 수 없음)</td>
              <td>탈퇴 시 즉시 삭제</td>
            </tr>
            <tr>
              <td>학교 이름·학교 아이디</td>
              <td>같은 학교 선생님들에게 과목·출판사 목록을 보여 주기 위함</td>
              <td>탈퇴 시 즉시 삭제</td>
            </tr>
            <tr>
              <td>접속 기록(인증 서비스 자동 기록)</td>
              <td>부정 이용 방지</td>
              <td>인증 서비스 정책에 따름</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">가입 없이 학교 아이디만 넣어 쓰는 선생님의 개인정보는 수집하지 않습니다.</p>

        <h3>3. 함께 저장되는 학교 자료</h3>
        <p>담당자 계정으로 등록한 <b>선정 대상 과목</b>과 <b>과목별 출판사 목록</b>이 저장됩니다. 이는 개인정보가 아니며, 학교 아이디를 아는 사람은 읽을 수 있고 담당자 계정만 고칠 수 있습니다.</p>

        <h3>4. 처리 위탁</h3>
        <p>계정 인증과 학교 자료 보관은 Google Firebase(Authentication, Cloud Firestore)를 이용합니다. 서비스 제공 목적 외에는 이용하지 않습니다.</p>

        <h3>5. 이용자의 권리</h3>
        <ul>
          <li><b>열람·내려받기</b> — 설정 › 문서·AI 설정에서 등록한 과목·출판사를 파일로 내려받을 수 있습니다.</li>
          <li><b>정정</b> — 설정 › 과목·출판사에서 언제든 고칠 수 있고, 비밀번호는 설정 › 학교 계정에서 바꿀 수 있습니다.</li>
          <li>
            <b>삭제(탈퇴)</b> — 설정 › 학교 계정의 [탈퇴]를 누르면 계정과 학교 자료(과목·출판사)가 <b>즉시 함께 삭제</b>되며 되돌릴 수 없습니다.
          </li>
        </ul>

        <h3>6. 안전성 확보</h3>
        <p>비밀번호는 인증 서비스가 암호화해 보관합니다. 학교 자료는 담당자 본인 계정만 수정·삭제할 수 있도록 접근 규칙을 두고 있습니다.</p>

        <h3>7. 문의</h3>
        <p>이 서비스는 {master.settings.schoolName || '학교'} 업무 지원을 위해 운영됩니다. 개인정보 관련 문의는 서비스를 안내한 담당 선생님에게 해 주세요.</p>

        <div className="actions">
          <button className="btn" onClick={() => go('settings')}>
            설정으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  )
}
