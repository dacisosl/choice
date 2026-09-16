/**
 * 설정 파일(JSON) — 단위학교가 평가기준·의견 선택지·문서 설정을 한 파일로 나눠 쓰기 위한 것.
 * 개인 문서(평가표·총괄표)는 넣지 않는다. 앱과 함께 오는 교과서 자료(source: 'catalog')도 빼고,
 * 학교가 직접 넣은 과목·출판사만 담는다.
 */
import type { Criterion, Master, OpinionOption, Publisher, Settings, Subject } from '../types'
import { DEFAULT_SETTINGS } from '../seed'

export const SETTINGS_FILE_KIND = 'choice-settings'

export interface SettingsFile {
  _설명?: string
  kind: typeof SETTINGS_FILE_KIND
  version: 1
  exportedAt: string
  settings: Settings
  criteria: Criterion[]
  opinionOptions: OpinionOption[]
  /** 학교가 직접 넣은 과목·출판사 (교과서 자료에서 온 것은 빼고) */
  subjects: Subject[]
  publishers: Publisher[]
}

export function buildSettingsFile(master: Master): SettingsFile {
  const subjects = master.subjects.filter((s) => s.source !== 'catalog')
  const own = new Set(subjects.map((s) => s.id))
  const publishers = master.publishers.filter((p) => p.source !== 'catalog' && (own.has(p.subjectId) || master.subjects.some((s) => s.id === p.subjectId)))
  return {
    _설명: '선정초안작성기 설정 파일. 첫 화면의 [설정 JSON] → [불러오기]로 다른 컴퓨터에 그대로 옮길 수 있습니다. 평가기준·의견 선택지·문서 설정과 직접 넣은 과목·출판사가 들어 있고, 작성한 평가표는 들어 있지 않습니다.',
    kind: SETTINGS_FILE_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: master.settings,
    criteria: master.criteria,
    opinionOptions: master.opinionOptions,
    subjects,
    publishers,
  }
}

export function settingsFileName(master: Master): string {
  const school = (master.settings.schoolName || '').trim() || '학교'
  return `선정초안작성기 설정_${school}_${new Date().toISOString().slice(0, 10)}.json`
}

/** 파일 내용을 검사한다. 문제가 있으면 이유를 던진다 */
export function parseSettingsFile(text: string): SettingsFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('JSON 파일이 아닙니다.')
  }
  const f = raw as Partial<SettingsFile>
  if (!f || typeof f !== 'object' || f.kind !== SETTINGS_FILE_KIND) {
    throw new Error('선정초안작성기 설정 파일이 아닙니다. 첫 화면의 [설정 JSON] → [저장]으로 만든 파일을 골라 주세요.')
  }
  const criteria = Array.isArray(f.criteria) ? f.criteria.filter((c) => c && typeof c.area === 'string' && typeof c.text === 'string') : []
  if (!criteria.length) throw new Error('파일에 평가기준이 없습니다.')
  return {
    kind: SETTINGS_FILE_KIND,
    version: 1,
    exportedAt: typeof f.exportedAt === 'string' ? f.exportedAt : '',
    settings: { ...DEFAULT_SETTINGS, ...(f.settings || {}) },
    criteria: criteria.map((c, i) => ({ ...c, id: c.id || `crit-file-${i + 1}`, subjectId: c.subjectId ?? null, points: Number(c.points) || 0, locked: !!c.locked, order: Number(c.order) || i + 1 })),
    opinionOptions: Array.isArray(f.opinionOptions) ? f.opinionOptions : [],
    subjects: Array.isArray(f.subjects) ? f.subjects.filter((s) => s && s.id && s.name) : [],
    publishers: Array.isArray(f.publishers) ? f.publishers.filter((p) => p && p.id && p.subjectId && p.name) : [],
  }
}

export interface ApplyResult {
  master: Master
  /** 무엇이 바뀌었는지 사람에게 보여 줄 줄 */
  lines: string[]
}

/**
 * 파일의 설정을 이 컴퓨터에 적용한다.
 * 평가기준·의견 선택지·문서 설정은 파일 것으로 바꾸고, 과목·출판사는 없는 것만 더한다
 * (교과서 자료에서 온 것과 이미 있는 것은 그대로).
 */
export function applySettingsFile(master: Master, f: SettingsFile): ApplyResult {
  const haveSubject = new Set(master.subjects.map((s) => s.id))
  const newSubjects = f.subjects.filter((s) => !haveSubject.has(s.id))
  const allSubjects = [...master.subjects, ...newSubjects]
  const subjectIds = new Set(allSubjects.map((s) => s.id))
  const havePub = new Set(master.publishers.map((p) => p.id))
  const newPubs = f.publishers.filter((p) => !havePub.has(p.id) && subjectIds.has(p.subjectId))

  const lines = [
    `평가기준 ${f.criteria.filter((c) => c.subjectId === null).length}항목 (배점 합 ${f.criteria.filter((c) => c.subjectId === null).reduce((s, c) => s + c.points, 0)}점)` +
      (f.criteria.some((c) => c.subjectId !== null) ? ` · 과목 전용 기준 ${new Set(f.criteria.filter((c) => c.subjectId !== null).map((c) => c.subjectId)).size}과목` : ''),
    f.opinionOptions.length ? `의견 선택지 ${f.opinionOptions.length}개` : '의견 선택지: 파일에 없어 지금 것을 둡니다',
    `문서 설정 (학교명 ${f.settings.schoolName || '-'} · ${f.settings.year || '-'}학년도 · 목표 점수 ${f.settings.targetScores.r1}/${f.settings.targetScores.r2}/${f.settings.targetScores.r3})`,
    newSubjects.length || newPubs.length ? `직접 넣은 과목 ${newSubjects.length}개 · 출판사 ${newPubs.length}곳 추가` : '직접 넣은 과목·출판사: 새로 더할 것 없음',
  ]

  return {
    master: {
      ...master,
      settings: f.settings,
      criteria: f.criteria,
      opinionOptions: f.opinionOptions.length ? f.opinionOptions : master.opinionOptions,
      subjects: allSubjects,
      publishers: [...master.publishers, ...newPubs],
    },
    lines,
  }
}
