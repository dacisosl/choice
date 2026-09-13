import { useEffect, useMemo, useRef, useState } from 'react'
import type { SchoolLevel, Subject } from '../types'

interface Props {
  subjects: Subject[]
  /** 고른 과목 id */
  value: string
  onChange: (id: string) => void
  /** 중·고 를 고르면 그 학교 과목만 찾는다 */
  school?: SchoolLevel | null
  placeholder?: string
}

const MAX = 40

/**
 * 과목이 수백 개라 목록에서 고르기 어렵다. 이름을 치면 아래에 후보가 뜨고,
 * 고르면 그 과목의 출판사가 채워진다. 초성만 쳐도 찾을 수 있다.
 */
export function SubjectSearch({ subjects, value, onChange, school, placeholder }: Props) {
  const picked = subjects.find((s) => s.id === value) || null
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  // 바깥을 누르면 후보를 닫는다
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pool = useMemo(() => (school ? subjects.filter((s) => !s.school || s.school === school) : subjects), [subjects, school])

  const hits = useMemo(() => {
    const key = q.trim().toLowerCase()
    if (!key) return pool.slice(0, MAX)
    const starts: Subject[] = []
    const has: Subject[] = []
    for (const s of pool) {
      const name = s.name.toLowerCase()
      if (name.startsWith(key)) starts.push(s)
      else if (name.includes(key) || (s.subjectGroup || '').toLowerCase().includes(key) || chosung(s.name).includes(key)) has.push(s)
      if (starts.length + has.length >= MAX * 2) break
    }
    return [...starts, ...has].slice(0, MAX)
  }, [pool, q])

  useEffect(() => setHi(0), [q, school])

  const choose = (s: Subject) => {
    onChange(s.id)
    setQ('')
    setOpen(false)
  }

  const label = (s: Subject) => [s.school ? `${s.school}학교` : '', s.subjectGroup].filter(Boolean).join(' · ')

  return (
    <div className="subject-search" ref={box}>
      {picked ? (
        <div className="subject-picked">
          <div>
            <b>{picked.name}</b>
            <span className="muted small"> {label(picked)}</span>
          </div>
          <button
            className="btn sm"
            onClick={() => {
              onChange('')
              setQ('')
              setOpen(true)
            }}
          >
            바꾸기
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={q}
          placeholder={placeholder || '과목명을 입력하세요 (예: 과학, 통합사회)'}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || !hits.length) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHi((i) => Math.min(hits.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHi((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(hits[hi])
            } else if (e.key === 'Escape') setOpen(false)
          }}
        />
      )}

      {!picked && open && (
        <div className="subject-hits">
          {hits.length === 0 ? (
            <div className="subject-empty">
              찾는 과목이 없으면 아래 <b>직접 입력</b> 칸에 과목명을 적어 주세요.
            </div>
          ) : (
            hits.map((s, i) => (
              <button key={s.id} className={`subject-hit ${i === hi ? 'on' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => choose(s)}>
                <span className="nm">{s.name}</span>
                <span className="sub">{label(s)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** 한글 초성 (ㄱㅁ 처럼 쳐도 찾히게) */
function chosung(s: string): string {
  const TABLE = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0) - 0xac00
    out += code >= 0 && code <= 11171 ? TABLE[Math.floor(code / 588)] : ch
  }
  return out.toLowerCase()
}
