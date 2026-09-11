import type { FirebaseConfig } from '../types'

type FirebaseApp = import('firebase/app').FirebaseApp

let appPromise: Promise<FirebaseApp> | null = null
let appCheckState: 'off' | 'on' | 'failed' = 'off'

/** App Check 활성 여부 (관리 화면 표시용) */
export function getAppCheckState() {
  return appCheckState
}

const isLocalHost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)

/**
 * App Check 초기화. 사이트 키가 없으면 건너뛴다.
 * 다른 Firebase 서비스를 쓰기 전에 호출해야 하며, 실패해도 앱을 멈추지 않는다.
 */
async function initAppCheck(app: FirebaseApp, cfg: FirebaseConfig): Promise<void> {
  const ac = cfg.appCheck
  if (!ac?.siteKey || appCheckState !== 'off') return
  try {
    const m = await import('firebase/app-check')
    if (isLocalHost()) {
      // 로컬 개발: 콘솔에 등록한 디버그 토큰 사용. true면 콘솔 로그에 토큰이 출력된다.
      ;(self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = ac.debugToken || true
    }
    m.initializeAppCheck(app, {
      provider: ac.provider === 'v3' ? new m.ReCaptchaV3Provider(ac.siteKey) : new m.ReCaptchaEnterpriseProvider(ac.siteKey),
      isTokenAutoRefreshEnabled: true,
    })
    appCheckState = 'on'
  } catch (e) {
    appCheckState = 'failed'
    console.warn('App Check 초기화 실패', e)
  }
}

/** Firebase 앱을 한 번만 초기화해서 재사용 (저장소·인증 공용) */
export function ensureFirebaseApp(cfg: FirebaseConfig): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = (async () => {
      const { initializeApp, getApps } = await import('firebase/app')
      const app =
        getApps()[0] ||
        initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId })
      await initAppCheck(app, cfg)
      return app
    })()
  }
  return appPromise
}

export function hasFirebaseConfig(cfg?: FirebaseConfig | null): cfg is FirebaseConfig {
  return !!(cfg && cfg.apiKey && cfg.projectId)
}

/** 구성원 명단 컬렉션 (문서 id = 로그인 uid) */
export const MEMBERS_COLLECTION = 'choice_members'
