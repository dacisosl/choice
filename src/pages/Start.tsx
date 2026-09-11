import { useAppData } from '../store/useAppData'

export function Start({ go }: { go: (h: string) => void }) {
  const { master, mode, evaluations, summaries } = useAppData()
  const submitted = evaluations.filter((e) => e.status === 'submitted').length
  const finalized = summaries.filter((s) => s.status === 'finalized').length
  const subjectsWithPubs = master.subjects.filter((s) => master.publishers.filter((p) => p.subjectId === s.id).length > 1).length
  return (
    <div>
      <section className="hero">
        <div className="school">
          {master.settings.schoolName} · {master.settings.year}학년도 검·인정 교과용도서 선정
        </div>
        <h1>
          선생님, <span className="red">서류</span>는 <span className="navy">제가 만듭니다.</span>
        </h1>
        <p className="lead">
          과목과 <b>1·2·3순위 출판사</b>만 고르면 서식1 평가표와 추천 의견서 초안이 완성됩니다. 총괄 교사는 제출된 결과로 서식2 총괄표를 자동 집계합니다.
        </p>
        <div className="start-grid">
          <div className="start-card" onClick={() => go('personal')}>
            <div className="icon">①</div>
            <h2>개인서류 작성</h2>
            <p>교과협의회 위원 · 서식1 선정 평가표와 개인 추천의견 초안을 만들고 제출합니다.</p>
            <span className="go">시작하기</span>
          </div>
          <div className="start-card" onClick={() => go('compile')}>
            <div className="icon red">②</div>
            <h2>평가총괄표 작성</h2>
            <p>총괄 작성 교사 · 제출 현황을 확인하고 서식2 총괄표와 공식 서식3을 생성·확정합니다.</p>
            <span className="go">시작하기</span>
          </div>
          <div className="start-card" onClick={() => go('admin')}>
            <div className="icon gray">⚙</div>
            <h2>관리</h2>
            <p>과목·출판사·평가기준·의견 선택지, 학교 설정, 진행 현황, 백업.</p>
            <span className="go">열기</span>
          </div>
        </div>
        <div className="caption-row">
          <span>
            <b>{subjectsWithPubs}</b>개 과목 작성 가능
          </span>
          <span>
            제출 <b>{submitted}</b>건
          </span>
          <span>
            총괄 확정 <b>{finalized}</b>과목
          </span>
          <span>{mode === 'supabase' ? '온라인 공유 모드' : '이 브라우저 저장 모드'}</span>
          <span>A4 서식 그대로 인쇄</span>
        </div>
      </section>
      {mode === 'local' && (
        <p className="start-note">
          현재 데이터는 이 브라우저에만 저장됩니다. 여러 교사가 함께 쓰려면 관리 › 설정에서 Supabase 연결 정보를 넣거나, 개인서류 화면의 [파일로 내보내기]로 제출 파일을 총괄 교사에게 전달하세요.
        </p>
      )}
    </div>
  )
}
