import type { FirebaseConfig, Publisher, Subject } from '../types'

/**
 * 학교 계정 · 학교별 공유 데이터(선정 대상 과목, 과목별 출판사).
 *
 * · 학교당 계정 하나. 담당자가 이메일·비밀번호로 가입하며, 가입 시 정한 '학교 아이디'로
 *   Firestore 문서 schools/{schoolId} 를 만든다.
 * · 교사는 가입 없이 학교 아이디만 입력해 그 문서를 읽는다(규칙: 단건 읽기 허용).
 * · 개인 평가표·총괄표·점수는 여기에 저장되지 않는다. 각자의 컴퓨터에만 있다.
 */
type FirebaseApp = import('firebase/app').FirebaseApp
type Fs = typeof import('firebase/firestore')
type Firestore = import('firebase/firestore').Firestore

let appPromise: Promise<FirebaseApp> | null = null

export const SCHOOLS_COLLECTION = 'schools'
/** 학교 아이디 목록(운영자용). 과목·출판사 내용은 넣지 않는다 */
export const SCHOOL_INDEX_COLLECTION = 'school_index'

export interface SchoolDoc {
  schoolId: string
  schoolName: string
  ownerUid: string
  subjects: Subject[]
  publishers: Publisher[]
  createdAt: string
  updatedAt: string
}

export interface AccountUser {
  uid: string
  email: string
}

/** 운영자 화면에 보이는 학교 정보. 과목·출판사 내용은 담지 않는다 */
export interface SchoolIndexEntry {
  schoolId: string
  schoolName: string
  ownerUid: string
  ownerEmail: string
  createdAt: string
  updatedAt: string
}

export function hasFirebaseConfig(cfg?: FirebaseConfig | null): cfg is FirebaseConfig {
  return !!(cfg && cfg.apiKey && cfg.projectId)
}

/** 학교 아이디 규칙: 영문 소문자·숫자·하이픈 3~30자 (URL·문서 id로 그대로 쓴다) */
export const SCHOOL_ID_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/
export function normalizeSchoolId(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, '-')
}
export function schoolIdError(v: string): string | null {
  const id = normalizeSchoolId(v)
  if (!id) return '학교 아이디를 입력하세요.'
  if (!SCHOOL_ID_RE.test(id)) return '학교 아이디는 영문 소문자·숫자·하이픈 3~30자로 만들어 주세요. (예: haemil-high)'
  return null
}

function ensureApp(cfg: FirebaseConfig): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = (async () => {
      const { initializeApp, getApps } = await import('firebase/app')
      return getApps()[0] || initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId })
    })()
  }
  return appPromise
}

async function getStore(cfg: FirebaseConfig): Promise<{ fs: Fs; db: Firestore }> {
  const [app, fs] = await Promise.all([ensureApp(cfg), import('firebase/firestore')])
  const id = (cfg.databaseId || '').trim()
  const db = id && id !== '(default)' ? fs.getFirestore(app, id) : fs.getFirestore(app)
  return { fs, db }
}

async function getAuth(cfg: FirebaseConfig) {
  const [app, auth] = await Promise.all([ensureApp(cfg), import('firebase/auth')])
  return { auth, a: auth.getAuth(app) }
}

// ───────────── 학교 문서 ─────────────

export async function fetchSchool(cfg: FirebaseConfig, schoolId: string): Promise<SchoolDoc | null> {
  const { fs, db } = await getStore(cfg)
  const snap = await fs.getDoc(fs.doc(db, SCHOOLS_COLLECTION, schoolId))
  return snap.exists() ? (snap.data() as SchoolDoc) : null
}

/** 담당자가 과목·출판사를 바꾸면 교사 화면도 새로고침 없이 갱신되도록 구독 */
export async function subscribeSchool(
  cfg: FirebaseConfig,
  schoolId: string,
  cb: (doc: SchoolDoc | null) => void,
  onError: (e: Error) => void,
): Promise<() => void> {
  const { fs, db } = await getStore(cfg)
  return fs.onSnapshot(
    fs.doc(db, SCHOOLS_COLLECTION, schoolId),
    (snap) => cb(snap.exists() ? (snap.data() as SchoolDoc) : null),
    (e) => onError(e as Error),
  )
}

/** 소유자만 호출한다. undefined 는 Firestore가 거부하므로 JSON 왕복으로 제거 */
export async function saveSchoolData(cfg: FirebaseConfig, schoolId: string, data: { schoolName?: string; subjects: Subject[]; publishers: Publisher[] }): Promise<void> {
  const { fs, db } = await getStore(cfg)
  const updatedAt = new Date().toISOString()
  const clean = JSON.parse(JSON.stringify({ ...data, updatedAt }))
  await fs.setDoc(fs.doc(db, SCHOOLS_COLLECTION, schoolId), clean, { merge: true })
  try {
    await fs.setDoc(fs.doc(db, SCHOOL_INDEX_COLLECTION, schoolId), { schoolName: data.schoolName || '', updatedAt }, { merge: true })
  } catch {
    /* 목록 갱신 실패는 무시 */
  }
}

export async function createSchool(cfg: FirebaseConfig, doc: SchoolDoc, ownerEmail: string): Promise<void> {
  const { fs, db } = await getStore(cfg)
  await fs.setDoc(fs.doc(db, SCHOOLS_COLLECTION, doc.schoolId), JSON.parse(JSON.stringify(doc)))
  await fs.setDoc(fs.doc(db, SCHOOL_INDEX_COLLECTION, doc.schoolId), {
    schoolId: doc.schoolId,
    schoolName: doc.schoolName,
    ownerUid: doc.ownerUid,
    ownerEmail,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  })
}

export async function deleteSchool(cfg: FirebaseConfig, schoolId: string): Promise<void> {
  const { fs, db } = await getStore(cfg)
  await fs.deleteDoc(fs.doc(db, SCHOOLS_COLLECTION, schoolId))
  try {
    await fs.deleteDoc(fs.doc(db, SCHOOL_INDEX_COLLECTION, schoolId))
  } catch (e) {
    console.warn('학교 목록 항목 삭제 실패', e)
  }
}

// ───────────── 계정 ─────────────

export async function watchAccount(cfg: FirebaseConfig, cb: (u: AccountUser | null) => void): Promise<() => void> {
  const { auth, a } = await getAuth(cfg)
  return auth.onAuthStateChanged(a, (u) => cb(u ? { uid: u.uid, email: u.email || '' } : null))
}

export async function signUp(cfg: FirebaseConfig, email: string, password: string): Promise<AccountUser> {
  const { auth, a } = await getAuth(cfg)
  const cred = await auth.createUserWithEmailAndPassword(a, email.trim(), password)
  return { uid: cred.user.uid, email: cred.user.email || '' }
}

export async function signIn(cfg: FirebaseConfig, email: string, password: string): Promise<AccountUser> {
  const { auth, a } = await getAuth(cfg)
  const cred = await auth.signInWithEmailAndPassword(a, email.trim(), password)
  return { uid: cred.user.uid, email: cred.user.email || '' }
}

export async function signOutAccount(cfg: FirebaseConfig): Promise<void> {
  const { auth, a } = await getAuth(cfg)
  await auth.signOut(a)
}

export async function sendReset(cfg: FirebaseConfig, email: string): Promise<void> {
  const { auth, a } = await getAuth(cfg)
  await auth.sendPasswordResetEmail(a, email.trim())
}

export async function changePassword(cfg: FirebaseConfig, currentPassword: string, nextPassword: string): Promise<void> {
  const { auth, a } = await getAuth(cfg)
  const u = a.currentUser
  if (!u || !u.email) throw new Error('로그인 상태가 아닙니다.')
  await auth.reauthenticateWithCredential(u, auth.EmailAuthProvider.credential(u.email, currentPassword))
  await auth.updatePassword(u, nextPassword)
}

/** 탈퇴: 학교 문서를 먼저 지우고 계정을 삭제한다 (규칙상 소유자 인증이 살아 있어야 문서를 지울 수 있음) */
export async function deleteAccount(cfg: FirebaseConfig, currentPassword: string, schoolId: string | null): Promise<void> {
  const { auth, a } = await getAuth(cfg)
  const u = a.currentUser
  if (!u || !u.email) throw new Error('로그인 상태가 아닙니다.')
  await auth.reauthenticateWithCredential(u, auth.EmailAuthProvider.credential(u.email, currentPassword))
  if (schoolId) {
    try {
      await deleteSchool(cfg, schoolId)
    } catch (e) {
      console.warn('학교 문서 삭제 실패', e)
      throw new Error(`학교 자료를 지우지 못해 탈퇴를 중단했습니다: ${(e as Error).message}`)
    }
  }
  await auth.deleteUser(u)
}

// ───────────── 운영자(최종 관리자) ─────────────

export function isSuperAdmin(cfg: FirebaseConfig, email: string | null | undefined): boolean {
  if (!email) return false
  const list = (cfg.superAdmins || []).map((e) => e.trim().toLowerCase()).filter(Boolean)
  return list.includes(email.trim().toLowerCase())
}

/** 운영자 전용 구글 로그인 (학교 담당자 계정은 이메일·비밀번호를 쓴다) */
export async function signInWithGoogle(cfg: FirebaseConfig): Promise<void> {
  const { auth, a } = await getAuth(cfg)
  const provider = new auth.GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  try {
    await auth.signInWithPopup(a, provider)
  } catch (e) {
    const code = (e as { code?: string }).code || ''
    if (code.includes('popup-blocked') || code.includes('operation-not-supported')) await auth.signInWithRedirect(a, provider)
    else throw e
  }
}

/** 학교 아이디 목록. 과목·출판사 내용은 이 컬렉션에 없다 */
export async function listSchools(cfg: FirebaseConfig): Promise<SchoolIndexEntry[]> {
  const { fs, db } = await getStore(cfg)
  const snap = await fs.getDocs(fs.collection(db, SCHOOL_INDEX_COLLECTION))
  return snap.docs
    .map((d) => d.data() as SchoolIndexEntry)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

/** Firebase 오류 코드를 사람이 읽는 문장으로 */
export function authErrorText(e: unknown): string {
  const code = (e as { code?: string }).code || ''
  if (code.includes('email-already-in-use')) return '이미 가입된 이메일입니다. 로그인하거나 비밀번호 재설정을 이용하세요.'
  if (code.includes('invalid-email')) return '이메일 형식이 올바르지 않습니다.'
  if (code.includes('weak-password')) return '비밀번호는 6자 이상이어야 합니다.'
  if (code.includes('operation-not-allowed')) return '이 프로젝트에서 이메일/비밀번호 로그인이 아직 켜져 있지 않습니다. Firebase 콘솔 › Authentication › Sign-in method 에서 사용 설정하세요.'
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
    return '이메일 또는 비밀번호가 올바르지 않습니다.'
  if (code.includes('too-many-requests')) return '시도가 너무 많습니다. 잠시 후 다시 시도하세요.'
  if (code.includes('network-request-failed')) return '네트워크 오류로 처리하지 못했습니다.'
  if (code.includes('requires-recent-login')) return '보안을 위해 다시 로그인한 뒤 시도해 주세요.'
  if (code.includes('permission-denied')) return '권한이 없습니다. 이 학교 아이디의 담당자 계정으로 로그인했는지 확인하세요.'
  return (e as Error).message
}
