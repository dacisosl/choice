# 검·인정 교과용도서 선정 문서 작성 웹앱

「2027학년도 검‧인정 교과용도서 선정 계획(안)」의 서식1(선정 평가표)·서식2(평가 총괄표)·서식3(추천 의견서)을
자동 초안 생성 → 인라인 편집 → 제출 → 과목별 자동 집계 → A4 인쇄까지 처리하는 웹앱입니다.
개발 계획서: [교과서선정_문서작성_웹앱_개발계획.md](./교과서선정_문서작성_웹앱_개발계획.md)

- **배포 주소**: https://dacisosl.github.io/choice/
- `main` 브랜치에 push 하면 GitHub Actions가 자동으로 빌드·배포합니다.

## 기능 요약

| 화면 | 내용 |
|---|---|
| ① 개인서류 작성 | 교사명·과목·1/2/3순위 선택 → 서식1 점수표 자동 초안 → 셀 편집(배점 초과 경고, 합계 재계산) → 핵심의견 체크 후 의견 생성 → 개인 추천의견(서식3형) → 미리보기·제출·인쇄/PDF·JSON 내보내기 |
| ② 평가총괄표 작성 | 과목별 제출 현황(위원 3인 미만 경고) → 서식2 위원 열·출판사 행 자동, 총점·평균·순위(동점 처리) 자동 → 공식 서식3 (평균 순위 자동, 위원 의견 종합 생성) → 확정 시 과목 마감(개인 문서 수정 차단) |
| ⚙ 관리 | 과목·출판사(CSV 업로드), 평가기준(기본 템플릿/과목별 오버라이드, 합계 100 검증, 가격·재정 항목 삭제 잠금), 의견 선택지, 위원 명단, 설정(문체·목표 총점·접속 코드·AI 모델), 진행 현황, 백업/복원 |

## 데이터베이스 (제출 데이터 보관)

GitHub Pages는 정적 호스팅이므로 앱 자체에는 서버가 없습니다. 저장 계층은 어댑터 방식이며 `public/config.json` 만 바꾸면 전환됩니다.

| 모드 | 조건 | 특징 |
|---|---|---|
| 브라우저 저장 (기본) | `config.json` 의 DB 항목이 모두 비어 있음 | 각 교사의 브라우저(localStorage)에만 저장. 위원은 [파일로 내보내기(JSON)] → 총괄 교사가 [제출 파일 가져오기]로 취합 |
| **Supabase** (Postgres) | `supabaseUrl`, `supabaseAnonKey` 입력 | 무료 티어로 충분. 테이블 1개(`docs`)에 마스터·개인 제출·총괄표를 JSON으로 보관 |
| **Firebase Firestore** | `firebase.apiKey`, `firebase.projectId` 등 입력 | 무료 Spark 플랜으로 충분. 컬렉션 1개(`docs`) 사용 |

저장되는 문서 종류는 세 가지입니다.

| kind | 내용 | 개수 |
|---|---|---|
| `master` | 과목·출판사·평가기준·의견 선택지·위원 명단·설정 | 1건 |
| `evaluation` | 위원 개인 제출본(서식1 점수·종합의견·개인 추천의견, 상태·제출일시) | 위원 × 과목 |
| `summary` | 과목별 총괄표(서식2 행렬·작성자/확인자·공식 서식3·확정일시) | 과목당 1건 |

### Supabase로 설정

1. https://supabase.com 에서 무료 프로젝트를 만듭니다.
2. SQL Editor에서 [`supabase/schema.sql`](./supabase/schema.sql) 을 실행합니다.
3. 프로젝트 설정 › API 에서 **Project URL** 과 **anon public key** 를 복사합니다.
4. [`public/config.json`](./public/config.json) 의 `supabaseUrl`, `supabaseAnonKey` 에 붙여 넣고 push 합니다.

### Firebase Firestore로 설정

1. https://console.firebase.google.com 에서 프로젝트를 만들고 **Firestore Database** 를 생성합니다(위치: asia-northeast3 권장).
2. Firestore › 규칙 탭에 [`firebase/firestore.rules`](./firebase/firestore.rules) 내용을 붙여 넣고 게시합니다.
3. 프로젝트 설정 › 내 앱 › 웹 앱 추가 후 표시되는 `firebaseConfig` 의 `apiKey`, `authDomain`, `projectId`, `appId` 를 복사합니다.
4. [`public/config.json`](./public/config.json) 의 `firebase` 항목에 붙여 넣고 push 합니다.

> **이미 쓰고 있는 Firebase 프로젝트를 재사용해도 됩니다.** 프로젝트 생성 한도에 걸렸다면 기존 프로젝트의 웹 앱 설정을 그대로 넣고, `collection` 을 다른 앱과 겹치지 않는 이름(기본 `choice_docs`)으로 두면 데이터가 분리됩니다. 규칙 파일에도 같은 컬렉션 이름을 허용해야 합니다.

```json
{
  "schoolName": "해밀고등학교",
  "year": 2027,
  "supabaseUrl": "",
  "supabaseAnonKey": "",
  "firebase": { "apiKey": "AIza...", "authDomain": "xxx.firebaseapp.com", "projectId": "xxx", "appId": "1:..." }
}
```

> anon 키·Firebase 웹 설정은 원래 공개되는 값입니다. 앱 진입은 관리 › 설정의 **접속 코드 / 총괄 코드 / 관리 코드**로 제어하세요.
> 관리 코드 초기값은 `1234` 이며, 배포 후 반드시 변경하세요.

### App Check로 접근 제한 (권장)

규칙만으로는 컬렉션이 누구에게나 열려 있습니다. App Check를 켜면 **등록한 사이트에서 온 요청만** Firestore에 도달합니다. 외부 스크립트나 다른 도메인에서의 직접 호출이 차단됩니다.

1. **reCAPTCHA 키 발급** — Google Cloud 콘솔 › 보안 › reCAPTCHA 에서 API를 사용 설정하고 **웹** 유형 키를 만듭니다. 도메인에 `dacisosl.github.io` 를 넣고, 체크박스 챌린지는 선택하지 않습니다(점수 기반). 키 ID를 복사합니다.
2. **Firebase에 등록** — Firebase 콘솔 › 보안 › **App Check** › 앱 탭에서 웹 앱을 고르고 **reCAPTCHA Enterprise** 공급업체에 위 키를 등록·저장합니다.
3. **앱에 반영** — [`public/config.json`](./public/config.json) 의 `firebase.appCheck.siteKey` 에 키를 넣고 push 합니다. 키가 비어 있으면 App Check는 켜지지 않습니다.
4. **적용(enforce)** — App Check › API 탭에서 Cloud Firestore를 먼저 **모니터링**으로 두고 요청이 정상 토큰으로 집계되는지 확인한 뒤 **적용**으로 바꿉니다.

> ⚠ **적용은 프로젝트 단위입니다.** 같은 Firebase 프로젝트의 다른 앱이 Firestore를 쓰고 있다면, 그 앱에도 App Check를 넣기 전까지 함께 차단됩니다. 기존 앱이 Realtime Database만 쓴다면 Firestore 적용은 영향을 주지 않습니다. 모니터링 단계에서 요청 출처를 먼저 확인하세요.

> App Check는 **사이트 밖에서의 접근**을 막습니다. 사이트 주소를 아는 사람이 브라우저로 직접 열어 보는 것까지 막지는 못합니다. 개인 평가 열람 자체를 통제하려면 Firebase 인증을 붙이고 규칙을 `request.auth != null` 로 바꾸는 2차 작업이 필요합니다.

로컬 개발(`localhost`)에서는 디버그 토큰이 쓰입니다. 브라우저 콘솔에 출력된 토큰을 App Check › 앱 › 디버그 토큰 관리에 등록하면 로컬에서도 통과합니다. 고정해서 쓰려면 `firebase.appCheck.debugToken` 에 넣으세요.

## AI 문장 생성 (선택)

관리 > 설정·현황 > **OpenRouter API 키**를 입력하면 핵심의견을 바탕으로 문장을 생성합니다.
키는 입력한 브라우저에만 저장되며, 키가 없거나 호출이 실패하면 규칙 기반 문장으로 자동 대체되어 작업이 멈추지 않습니다.

## 운영 순서 (권장)

1. 관리 > 과목·출판사: 과목별 출판사 입력 (CSV 업로드 가능, 서식 내려받기 제공).
2. 관리 > 평가기준: 기본 템플릿 확인, 필요 시 과목 전용 기준 생성.
3. 관리 > 설정: 접속 코드·관리 코드 변경, 문체·목표 총점 확정.
4. 위원에게 주소와 접속 코드 안내 → 개인서류 작성·제출.
5. 총괄 교사가 평가총괄표 작성 → 서식2·서식3 확정·인쇄.

## 개발

```bash
npm install
npm run dev      # http://localhost:5173/choice/
npm run build    # dist/
```

React 18 + Vite + TypeScript. 외부 UI 라이브러리 없이 `src/styles.css` 한 파일로 화면·인쇄(@media print, 서식1 A4 가로 / 서식2·3 세로) 스타일을 관리합니다.

```
src/
  seed.ts              과목 목록·기본 평가기준·의견 선택지 초기 데이터
  lib/scoring.ts       순위→점수 초안, 합계·평균·순위(동점) 계산
  lib/ai.ts            OpenRouter 호출 + 규칙 기반 폴백 문장
  store/storage.ts     localStorage / Supabase / Firestore 어댑터, App Check 초기화
  components/Form*.tsx 서식1·2·3 (화면·인쇄 공용)
  pages/               Start · Personal(S1~S4) · Compile(T1~T4) · Admin(A1~A4)
```
