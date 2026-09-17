/**
 * 조사 고르기 — '㈜천재교과서를', '㈜와이비엠을' 처럼 앞말에 맞는 조사를 붙인다.
 *
 * 출판사 이름에는 ㈜·㈔ 같은 기호와 '(전북교육청)' 같은 괄호가 섞여 있어
 * 마지막 글자만 보면 틀리기 쉽다. 소리 나는 대로 읽었을 때의 마지막 글자를 찾아 받침을 본다.
 */

/** 괄호 안이 이것뿐이면 읽지 않고 건너뛴다 (동아출판(주) → '판'을 본다) */
const CORP_MARK = /^(주|주식회사|재|재단법인|사|사단법인|유|유한회사|합|합자회사|㈜|㈔)$/

/** 회사 형태를 나타내는 기호는 읽지 않는다 */
const SKIP_CHAR = /[\s.,·․…∙•ㆍ'"’”)\]}〉》」』＞>㈜㈔㈐㈑㈒㈓㈕㈖*_\-–—/\\|]/

/** 숫자를 읽었을 때 받침이 있는가 (1 일, 3 삼, 6 육, 7 칠, 8 팔, 0 영) */
const DIGIT_JONG: Record<string, boolean> = { '0': true, '1': true, '2': false, '3': true, '4': false, '5': false, '6': true, '7': true, '8': true, '9': false }

/** 알파벳을 읽었을 때 받침이 있는가 (L 엘, M 엠, N 엔, R 알) */
const ALPHA_JONG: Record<string, boolean> = { l: true, m: true, n: true, r: true }

/** 앞말이 ㄹ 받침으로 끝나는가 ('로/으로' 는 ㄹ 뒤에서 '로') */
function endsWithRieul(ch: string): boolean {
  const code = ch.charCodeAt(0) - 0xac00
  if (code >= 0 && code <= 11171) return code % 28 === 8
  return /[lr]/i.test(ch)
}

/** 읽을 때 마지막에 오는 글자. 못 찾으면 '' */
export function lastReadChar(word: string): string {
  let s = String(word ?? '').trim()
  while (s) {
    // 괄호로 끝나면 그 안을 읽는다. 단 (주)·㈜ 같은 회사 표시는 건너뛴다
    const bracket = /[([{〈《「『＜<]([^()[\]{}〈〉《》「」『』＜＞<>]*)[)\]}〉》」』＞>]$/.exec(s)
    if (bracket) {
      const inner = bracket[1].trim()
      s = inner && !CORP_MARK.test(inner) ? inner : s.slice(0, bracket.index)
      continue
    }
    const ch = s.slice(-1)
    if (SKIP_CHAR.test(ch)) {
      s = s.slice(0, -1)
      continue
    }
    return ch
  }
  return ''
}

/** 앞말에 받침이 있는가. 알 수 없으면 null */
export function hasFinalConsonant(word: string): boolean | null {
  const ch = lastReadChar(word)
  if (!ch) return null
  const code = ch.charCodeAt(0) - 0xac00
  if (code >= 0 && code <= 11171) return code % 28 !== 0
  if (/[0-9]/.test(ch)) return DIGIT_JONG[ch]
  if (/[A-Za-z]/.test(ch)) return !!ALPHA_JONG[ch.toLowerCase()]
  return null
}

const PAIRS: Record<string, [string, string]> = {
  // [받침 있을 때, 받침 없을 때]
  을: ['을', '를'],
  를: ['을', '를'],
  이: ['이', '가'],
  가: ['이', '가'],
  은: ['은', '는'],
  는: ['은', '는'],
  와: ['과', '와'],
  과: ['과', '와'],
  로: ['으로', '로'],
  으로: ['으로', '로'],
  아: ['아', '야'],
  야: ['아', '야'],
}

/**
 * 앞말에 맞는 조사를 돌려준다.
 *   josa('㈜천재교과서', '을') → '를'   josa('㈜와이비엠', '을') → '을'
 *   josa('동아출판㈜', '을') → '을'     josa('㈔한국교과서협회(전북교육청)', '을') → '을'
 * 받침을 알 수 없으면 받침 없는 쪽(를·가·는·로)을 쓴다.
 */
export function josa(word: string, form: keyof typeof PAIRS | string): string {
  const pair = PAIRS[form]
  if (!pair) return form
  const jong = hasFinalConsonant(word)
  // '로/으로' 는 ㄹ 받침 뒤에서도 '로'
  if ((form === '로' || form === '으로') && jong && endsWithRieul(lastReadChar(word))) return '로'
  return jong ? pair[0] : pair[1]
}

/** 이름과 조사를 붙여 준다: withJosa('㈜미래엔', '을') → '㈜미래엔을' */
export function withJosa(word: string, form: string): string {
  return `${word}${josa(word, form)}`
}

/**
 * 어간에 관형형 '-은/-ㄴ' 을 붙인다: '높' → '높은', '부족하' → '부족한', '되' → '된'
 * (예전에는 늘 '은' 을 붙여 '부족하은 점' 처럼 나왔다)
 */
export function adnominal(stem: string): string {
  const ch = stem.slice(-1)
  const code = ch.charCodeAt(0) - 0xac00
  if (code >= 0 && code <= 11171) {
    if (code % 28 === 0) return stem.slice(0, -1) + String.fromCharCode(ch.charCodeAt(0) + 4) // 받침 ㄴ 을 넣는다
    return stem + '은'
  }
  return stem + '은'
}
