import type { Catalog, GradeGroup, Master, Publisher, Subject } from '../types'

/**
 * public/catalog.json — 과목별 교과서(출판사) 자료.
 * 앱과 함께 배포되며, 각 컴퓨터의 과목·출판사 목록을 이 자료로 채운다.
 * 선생님이 직접 넣은 과목·출판사(source 없음)는 건드리지 않는다.
 */

/** 자료가 바뀌었는지 가리는 값. 갱신일이 없으면 내용으로 만든다 */
export function catalogStamp(cat: Catalog): string {
  if (cat.updatedAt) return String(cat.updatedAt)
  const n = cat.subjects?.length || 0
  const pubs = (cat.subjects || []).reduce((a, s) => a + (s.publishers?.length || 0), 0)
  return `auto-${n}-${pubs}`
}

/** 과목명에서 안정적인 id 를 만든다 (자료를 다시 받아도 같은 id) */
function subjectId(name: string, given?: string): string {
  if (given && given.trim()) return given.trim()
  return `cat-${name.trim().replace(/\s+/g, '-')}`
}

export function applyCatalog(master: Master, cat: Catalog): Master {
  const subjects: Subject[] = []
  const publishers: Publisher[] = []

  for (const raw of cat.subjects || []) {
    const name = (raw.name || '').trim()
    if (!name) continue
    const id = subjectId(name, raw.id)
    if (subjects.some((s) => s.id === id)) continue
    subjects.push({
      id,
      name,
      gradeGroup: (raw.gradeGroup as GradeGroup) || '3',
      subjectGroup: (raw.subjectGroup || '').trim(),
      source: 'catalog',
    })
    ;(raw.publishers || []).forEach((p, i) => {
      const pubName = (typeof p === 'string' ? p : p?.name || '').trim()
      if (!pubName) return
      publishers.push({
        id: `${id}-p${i + 1}`,
        subjectId: id,
        name: pubName,
        order: i + 1,
        price: typeof p === 'string' ? undefined : p?.price,
        source: 'catalog',
      })
    })
  }

  // 직접 넣은 항목은 그대로 두고, 자료에서 온 항목만 갈아 끼운다
  const ownSubjects = master.subjects.filter((s) => s.source !== 'catalog' && !subjects.some((c) => c.id === s.id))
  const allSubjects = [...subjects, ...ownSubjects]
  const ownPublishers = master.publishers.filter((p) => p.source !== 'catalog' && allSubjects.some((s) => s.id === p.subjectId))

  return {
    ...master,
    subjects: allSubjects,
    publishers: [...publishers, ...ownPublishers],
    updatedAt: new Date().toISOString(),
  }
}
