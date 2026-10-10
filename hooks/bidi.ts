// Konsole runs the Unicode bidi algorithm over the whole row with a
// left-to-right base direction. Zero-width controls (RLM, LRM) are folded into
// the previous cell and ignored; embeddings and isolates draw as "?". So the
// visual order is computed here: the text is split into rows, each row into
// Persian and Latin runs, and the runs are emitted in reverse. The terminal
// then reverses the letters inside each Persian run itself, which leaves the
// row reading right to left. Styles ride on single characters, so they never
// affect the order.

export type Style = 'plain' | 'bold' | 'italic' | 'code'
// `g` marks the first character of a piece that was cut from a word at a change of
// script and so follows the previous piece with no space.
export type Ch = { c: string; s: Style; g?: boolean }
export type Word = Ch[]
export type Segment = { text: string; style: Style }
export type Row = { segments: Segment[]; width: number }

const NBSP = ' '
// Braille blank: a strong left-to-right character that draws as a blank cell.
// It stops a digit after Persian letters from turning into an Arabic number
// that the terminal would pull into the Persian run.
const L_ANCHOR = '⠀'
const PERSIAN = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/
const LETTER = /\p{L}/u
const LATIN = /\p{Script=Latin}/u
const ALNUM = /[\p{L}\p{N}]/u
const ZERO_WIDTH = /[​-‏‪-‮ً-ٰٟ]/
const LEAD = /[«(\[{"“‘<]/
const TRAIL = /[.,،؛;:!?؟…»)\]}"”’>]/
// The Arabic semicolon and question mark are right-to-left letters as far as
// bidi is concerned, unlike the Persian comma, which is neutral.
const STRONG_RTL_PUNCTUATION = /[\u061B\u061F]/
const MIRROR: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '«': '»', '»': '«', '<': '>', '>': '<',
  '‹': '›', '›': '‹', '❮': '❯', '❯': '❮', '❬': '❭', '❭': '❬', '❰': '❱', '❱': '❰', '⟨': '⟩', '⟩': '⟨',
}
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]*\))/

export const cellWidth = (text: string): number =>
  [...text].filter(c => !ZERO_WIDTH.test(c)).length

export const hasPersian = (text: string): boolean => [...text].some(c => PERSIAN.test(c))

const textOf = (word: Word): string => word.map(ch => ch.c).join('')

export const parseInline = (text: string, base: Style = 'plain'): Word[] => {
  const words: Word[] = []
  let current: Word = []

  for (const piece of text.split(INLINE)) {
    if (!piece) {
      continue
    }

    let style: Style = base
    let body = piece

    if (/^(\*\*|__)[^]+(\*\*|__)$/.test(piece)) {
      style = 'bold'
      body = piece.slice(2, -2)
    } else if (/^`[^`]+`$/.test(piece)) {
      style = 'code'
      body = piece.slice(1, -1)
    } else if (/^\*[^*]+\*$/.test(piece)) {
      style = base === 'bold' ? 'bold' : 'italic'
      body = piece.slice(1, -1)
    } else if (/^\[[^\]]+\]\([^)]*\)$/.test(piece)) {
      body = piece.slice(1, piece.indexOf(']'))
    }

    for (const c of body) {
      if (/\s/.test(c)) {
        if (current.length) {
          words.push(current)
        }

        current = []
      } else {
        current.push({ c, s: style })
      }
    }
  }

  if (current.length) {
    words.push(current)
  }

  return words
}

// One line of program output: every character kept as written, no markdown.
export const plainWords = (line: string): Word[] =>
  line
    .split(/\s+/)
    .filter(Boolean)
    .map(word => [...word].map(c => ({ c, s: 'plain' as Style })))

export const wrapWords = (words: Word[], width: number): Word[][] => {
  const rows: Word[][] = []
  let row: Word[] = []
  let used = 0

  for (const word of words) {
    const size = cellWidth(textOf(word))

    if (row.length && used + 1 + size > width) {
      rows.push(row)
      row = []
      used = 0
    }

    used += (row.length ? 1 : 0) + size
    row.push(word)
  }

  if (row.length) {
    rows.push(row)
  }

  return rows
}

type Script = 'R' | 'L'

// Only Persian letters and digits make a word right-to-left: the Persian comma
// and other punctuation live in the same Unicode block but are neutral.
const scriptOf = (word: Word): Script | null => {
  const text = textOf(word)

  return [...text].some(c => PERSIAN.test(c) && ALNUM.test(c)) ? 'R' : LETTER.test(text) ? 'L' : null
}

// A word that mixes the scripts (mod‌ها, کلاس‌Konsole, remote‌ای) is cut at each
// change of script into pieces that follow one another with no space. Left whole,
// its Latin letters split the Persian run around them and the terminal draws the
// pieces in the wrong order. A word with a code span in it is left alone.
const strongScriptOf = (c: string): Script | null =>
  PERSIAN.test(c) && ALNUM.test(c) ? 'R' : LATIN.test(c) ? 'L' : null

const splitMixedWords = (words: Word[]): Word[] =>
  words.flatMap(word => {
    if (word.some(ch => ch.s === 'code')) {
      return [word]
    }

    const pieces: Word[] = []
    let piece: Word = []
    let side: Script | null = null

    for (const ch of word) {
      const own = strongScriptOf(ch.c)

      if (own && side && own !== side) {
        pieces.push(piece)
        piece = []
      }

      side = own ?? side
      piece.push(ch)
    }

    pieces.push(piece)

    return pieces.map((part, i) => (i === 0 ? part : [{ ...part[0]!, g: true }, ...part.slice(1)]))
  })

// A code span is a literal: drawn as written, left to right, in one piece. Its
// words are therefore one Latin unit, whatever they hold (a path with Persian
// in it, a number in Persian digits), unless it is Persian text and nothing
// else, which reads like any Persian.
const codeSpanScripts = (words: Word[]): Map<number, Script> => {
  const scripts = new Map<number, Script>()
  const isCode = (word: Word): boolean => word.some(ch => ch.s === 'code')
  let i = 0

  while (i < words.length) {
    if (!isCode(words[i]!)) {
      i++

      continue
    }

    let j = i

    while (j < words.length && isCode(words[j]!)) {
      j++
    }

    const chars = words.slice(i, j).flat()
    const latin = chars.some(ch => LATIN.test(ch.c))
    const persian = chars.some(ch => PERSIAN.test(ch.c) && LETTER.test(ch.c))

    // Without a letter or a digit the span has nothing the terminal would call
    // left-to-right (a lone ● or /): it stays a neutral word of its neighbour.
    if (chars.some(ch => ALNUM.test(ch.c))) {
      for (let k = i; k < j; k++) {
        scripts.set(k, persian && !latin ? 'R' : 'L')
      }
    }

    i = j
  }

  return scripts
}

const mirrored = (chars: Ch[]): Ch[] =>
  [...chars].reverse().map(ch => ({ c: MIRROR[ch.c] ?? ch.c, s: ch.s }))

// Punctuation at the logical end of a run goes to its front and punctuation at
// its start goes to its back (brackets mirrored): a neutral at a run's edge is
// drawn on the left-to-right side of it, the wrong side for right-to-left
// text. Code characters are never touched.
const CLOSER: Record<string, string> = { '(': ')', '[': ']', '{': '}', '«': '»', '<': '>' }

// True when the word holds both halves of the bracket `c` belongs to, as in
// `mod(1)` or `(۱۲۳)`: such a pair is part of the word and stays where it is.
const isPaired = (word: Word, c: string): boolean => {
  const open = CLOSER[c] ? c : Object.keys(CLOSER).find(k => CLOSER[k] === c)

  if (!open) {
    return false
  }

  const count = (target: string) => word.filter(ch => ch.c === target).length

  return count(open) > 0 && count(open) === count(CLOSER[open]!)
}

const swapped = (word: Word): Word =>
  word.map(ch => (ch.s === 'code' ? ch : { c: MIRROR[ch.c] ?? ch.c, s: ch.s }))

// A number written as the first word of a Persian run (a heading's "۳.") is
// drawn by the terminal as left-to-right text, so it would land at the run's
// left end. It is emitted after the run instead, behind a blank
// left-to-right anchor, with its own edge punctuation moved around it.
const numberChars = (word: Word): Ch[] => {
  const chars = [...word]
  let n = 0

  while (n < chars.length && LEAD.test(chars[n]!.c) && chars[n]!.s !== 'code') {
    n++
  }

  const lead = n < chars.length ? chars.splice(0, n) : []
  let m = 0

  while (
    m < chars.length &&
    TRAIL.test(chars[chars.length - 1 - m]!.c) &&
    chars[chars.length - 1 - m]!.s !== 'code'
  ) {
    m++
  }

  const trail = m < chars.length ? chars.splice(chars.length - m, m) : []

  // A digit after a right-to-left letter (؟ ؛) turns into an Arabic number the
  // terminal joins to it; an anchor keeps the number apart.
  const anchor: Ch[] = trail.some(ch => STRONG_RTL_PUNCTUATION.test(ch.c)) ? [{ c: L_ANCHOR, s: 'plain' }] : []

  return [...mirrored(trail), ...anchor, ...chars, ...mirrored(lead)]
}

// A Persian run's text between brackets. ICU pairs an opening bracket with the
// next closing one, so swapping brackets one by one (to face the right way
// once the letters are reversed) makes pairs between neighbouring groups; when
// a Latin word lies between them the terminal draws those brackets left to
// right and breaks the run in two. A group that opens and closes inside the
// run is therefore emitted as an island: a real "(...)" pair behind a blank
// left-to-right anchor, which the terminal leaves in place, with its content
// laid out inside it. Brackets that only open or only close inside the run
// belong to a group that spans runs and are moved out as before.
//
// A bracket whose partner lies in another run (a group that spans a Latin word)
// and that is not at the edge of its run is emitted as a loose unit: it splits
// the run, so the stretches either side are laid out on their own and the
// bracket, which the terminal pairs with its partner and leaves in place,
// stands between them.
type Unit =
  | { t: 'text'; chars: Ch[] }
  | { t: 'group'; open: Ch; close: Ch; inner: Unit[] }
  | { t: 'loose'; ch: Ch }

const OPENER_TO_CLOSER: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSERS = new Set(Object.values(OPENER_TO_CLOSER))

const matchBrackets = (chars: Ch[], skip?: Set<Ch>): Map<number, number> => {
  const match = new Map<number, number>()
  const stack: number[] = []

  chars.forEach((ch, i) => {
    if (ch.s === 'code' || skip?.has(ch)) {
      return
    }

    if (OPENER_TO_CLOSER[ch.c]) {
      stack.push(i)
    } else if (CLOSERS.has(ch.c)) {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (OPENER_TO_CLOSER[chars[stack[k]!]!.c] === ch.c) {
          match.set(stack[k]!, i)
          stack.length = k

          break
        }
      }
    }
  })

  return match
}

const parseUnits = (
  chars: Ch[],
  match: Map<number, number>,
  lo: number,
  hi: number,
  loose: Set<Ch>,
): Unit[] => {
  const units: Unit[] = []
  let text: Ch[] = []
  let i = lo

  const flush = () => {
    if (text.length) {
      units.push({ t: 'text', chars: text })
      text = []
    }
  }

  while (i < hi) {
    const j = match.get(i)

    if (j !== undefined && j < hi) {
      flush()
      units.push({ t: 'group', open: chars[i]!, close: chars[j]!, inner: parseUnits(chars, match, i + 1, j, loose) })
      i = j + 1
    } else if (loose.has(chars[i]!)) {
      flush()
      units.push({ t: 'loose', ch: chars[i]! })
      i++
    } else {
      text.push(chars[i]!)
      i++
    }
  }

  flush()

  return units
}

const isSpace = (ch: Ch): boolean => ch.c === ' ' && ch.s === 'plain'

const splitWords = (chars: Ch[]): Word[] => {
  const words: Word[] = []
  let word: Word = []

  for (const ch of chars) {
    if (isSpace(ch)) {
      if (word.length) {
        words.push(word)
      }

      word = []
    } else {
      word.push(ch)
    }
  }

  if (word.length) {
    words.push(word)
  }

  return words
}

// Whether the text drawn so far ends in a left-to-right context: nothing yet
// (the start of the row), or a Latin letter or an anchor before any Persian
// letter. Digits do not decide it.
const endsLeftToRight = (chars: Ch[]): boolean => {
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i]!.c

    if (c === L_ANCHOR || (LETTER.test(c) && !PERSIAN.test(c))) {
      return true
    }

    if ((PERSIAN.test(c) && ALNUM.test(c) && !/\p{N}/u.test(c)) || STRONG_RTL_PUNCTUATION.test(c)) {
      return false
    }
  }

  return true
}

const emitUnits = (units: Unit[]): Ch[] => {
  const items = units.map(unit => {
    if (unit.t !== 'text') {
      return { unit, words: [] as Word[], before: false, after: false, glued: [] as Ch[], gluedBefore: [] as Ch[] }
    }

    const { chars } = unit

    return {
      unit,
      words: splitWords(chars),
      before: isSpace(chars[0]!),
      after: isSpace(chars[chars.length - 1]!),
      glued: [] as Ch[],
      gluedBefore: [] as Ch[],
    }
  })

  // Punctuation written against a bracket group belongs to the group: what
  // follows the closing bracket ("(...)،") sits beside the group's left
  // bracket in right-to-left text, and what precedes the opening one («(...)»)
  // beside its right bracket.
  items.forEach((item, g) => {
    if (item.unit.t !== 'group') {
      return
    }

    const next = items[g + 1]

    if (next && next.unit.t === 'text' && !next.before && next.words.length) {
      const first = next.words[0]!
      let n = 0

      while (n < first.length && TRAIL.test(first[n]!.c) && first[n]!.s !== 'code') {
        n++
      }

      if (n > 0) {
        item.glued = first.splice(0, n)

        if (!first.length) {
          next.words.shift()
          next.before = true
        }
      }
    }

    const previous = items[g - 1]

    if (previous && previous.unit.t === 'text' && !previous.after && previous.words.length) {
      const last = previous.words[previous.words.length - 1]!
      let m = 0

      while (m < last.length && LEAD.test(last[last.length - 1 - m]!.c) && last[last.length - 1 - m]!.s !== 'code') {
        m++
      }

      if (m > 0) {
        item.gluedBefore = last.splice(last.length - m, m)

        if (!last.length) {
          previous.words.pop()
          previous.after = true
        }
      }
    }
  })

  const out: Ch[] = []

  for (let i = items.length - 1; i >= 0; i--) {
    const { unit, words } = items[i]!
    const hasSpace = i < items.length - 1 && (items[i]!.after || items[i + 1]!.before)

    if (unit.t === 'group') {
      const { glued, gluedBefore } = items[i]!
      const strong = glued.some(ch => STRONG_RTL_PUNCTUATION.test(ch.c))

      // The group's opening bracket must follow a left-to-right context or the
      // terminal draws the pair right to left. Punctuation that is itself
      // right-to-left (؛ ؟) would also join the Persian text before it and
      // spoil the context, so it gets an anchor on each side.
      const anchor: Ch = { c: L_ANCHOR, s: 'plain' }
      const gap: Ch[] = !out.length ? [] : !endsLeftToRight(out) ? [anchor] : hasSpace ? [{ c: ' ', s: 'plain' }] : []

      out.push(...gap, ...mirrored(glued), ...(strong ? [anchor] : []))

      out.push(unit.open, ...emitUnits(unit.inner), unit.close, ...mirrored(gluedBefore))
    } else if (unit.t === 'loose') {
      if (out.length && hasSpace) {
        out.push({ c: ' ', s: 'plain' })
      }

      out.push({ c: MIRROR[unit.ch.c] ?? unit.ch.c, s: unit.ch.s })
    } else if (words.length) {
      if (hasSpace) {
        out.push({ c: ' ', s: 'plain' })
      }

      out.push(...chunkChars(words))
    }
  }

  return out
}

// A word with no letter, digit or mark in it: "●", "·", "—", "->". Such a word
// at the edge of a run is neutral text like the punctuation on a word, and is
// moved to the other end of the run for the same reason.
const NEUTRAL_WORD = /^[^\p{L}\p{N}\p{M}]+$/u

const isNeutralWord = (word: Word): boolean =>
  !word.some(ch => ch.s === 'code') && NEUTRAL_WORD.test(textOf(word)) && !STRONG_RTL_PUNCTUATION.test(textOf(word))

const splitNeutralEdges = (words: Word[]): { lead: Word[]; core: Word[]; trail: Word[] } => {
  let a = 0

  while (isNeutralWord(words[a]!)) {
    a++
  }

  let b = words.length

  while (isNeutralWord(words[b - 1]!)) {
    b--
  }

  return { lead: words.slice(0, a), core: words.slice(a, b), trail: words.slice(b) }
}

// Neutral words as they stand at an end of a run once moved: in reverse order,
// brackets mirrored, set apart from the run by one space.
const neutralWordsOut = (words: Word[]): Ch[] =>
  [...words].reverse().flatMap((word, i) => [...(i > 0 ? [{ c: ' ', s: 'plain' as Style }] : []), ...mirrored(word)])

const withNeutralEdges = (words: Word[], inner: (core: Word[]) => Ch[]): Ch[] => {
  // Only neutral words: the terminal leaves them in the order they are
  // handed over, so they go in the order they should be drawn.
  if (words.every(isNeutralWord)) {
    return neutralWordsOut(words)
  }

  const { lead, core, trail } = splitNeutralEdges(words)

  if (!lead.length && !trail.length) {
    return inner(words)
  }

  const space: Ch[] = [{ c: ' ', s: 'plain' }]

  return [
    ...neutralWordsOut(trail),
    ...(trail.length ? space : []),
    ...inner(core),
    ...(lead.length ? space : []),
    ...neutralWordsOut(lead),
  ]
}

// A stretch of Persian text with no bracket group in it, in the order the
// terminal should be handed it.
const chunkChars = (words: Word[]): Ch[] => withNeutralEdges(words, chunkCore)

const chunkCore = (words: Word[]): Ch[] => {
  if (startsWithDigit(words[0]!)) {
    const [number, ...rest] = words

    return rest.length
      ? [...chunkChars(rest), { c: L_ANCHOR, s: 'plain' }, ...numberChars(number!)]
      : numberChars(number!)
  }

  const parts = words.map(w => [...w])
  const first = parts[0]!
  const last = parts[parts.length - 1]!
  let lead: Ch[] = []
  let trail: Ch[] = []
  let n = 0

  while (n < first.length && LEAD.test(first[n]!.c) && first[n]!.s !== 'code') {
    n++
  }

  if (n < first.length) {
    lead = first.splice(0, n)
  }

  let m = 0

  // ؛ and ؟ are right-to-left letters to the terminal: left where they are
  // they come out at the end of the run, which is where they belong.
  while (
    m < last.length &&
    TRAIL.test(last[last.length - 1 - m]!.c) &&
    !STRONG_RTL_PUNCTUATION.test(last[last.length - 1 - m]!.c) &&
    last[last.length - 1 - m]!.s !== 'code'
  ) {
    m++
  }

  if (m < last.length) {
    trail = last.splice(last.length - m, m)
  }

  const out: Ch[] = [...mirrored(trail)]

  parts.forEach((word, i) => {
    if (i > 0) {
      out.push({ c: ' ', s: 'plain' })
    }

    // Konsole reverses the letters of a Persian run but does not mirror
    // brackets, so one left inside is swapped to come out facing the right way.
    out.push(...swapped(word))
  })

  return [...out, ...mirrored(lead)]
}

const runChars = (words: Word[], script: Script, spanning: Set<Ch>): Ch[] => {
  if (script === 'R') {
    const chars: Ch[] = []

    words.forEach((word, i) => {
      if (i > 0) {
        chars.push({ c: ' ', s: 'plain' })
      }

      chars.push(...word)
    })

    // A spanning bracket at the very edge of the run is moved out with the
    // run's other edge punctuation; one inside it splits the run.
    const edge = new Set<Ch>()
    const firstWord = words[0]!
    const lastWord = words[words.length - 1]!

    for (let n = 0; n < firstWord.length && LEAD.test(firstWord[n]!.c); n++) {
      edge.add(firstWord[n]!)
    }

    for (let m = lastWord.length - 1; m >= 0 && TRAIL.test(lastWord[m]!.c) && !STRONG_RTL_PUNCTUATION.test(lastWord[m]!.c); m--) {
      edge.add(lastWord[m]!)
    }

    const loose = new Set([...chars].filter(ch => spanning.has(ch) && !edge.has(ch)))

    return emitUnits(parseUnits(chars, matchBrackets(chars, spanning), 0, chars.length, loose))
  }

  // A Latin run is not reversed by the terminal, so its brackets and order are
  // left alone; only punctuation at its edges moves, as in a right-to-left
  // paragraph, and a bracket pair inside one word (mod(1)) stays.
  return withNeutralEdges(words, latinCore)
}

const latinCore = (words: Word[]): Ch[] => {
  const parts = words.map(w => [...w])
  const first = parts[0]!
  const last = parts[parts.length - 1]!
  let lead: Ch[] = []
  let trail: Ch[] = []
  let n = 0

  while (n < first.length && LEAD.test(first[n]!.c) && first[n]!.s !== 'code' && !isPaired(words[0]!, first[n]!.c)) {
    n++
  }

  if (n < first.length) {
    lead = first.splice(0, n)
  }

  let m = 0

  while (
    m < last.length &&
    TRAIL.test(last[last.length - 1 - m]!.c) &&
    last[last.length - 1 - m]!.s !== 'code' &&
    !isPaired(words[words.length - 1]!, last[last.length - 1 - m]!.c)
  ) {
    m++
  }

  if (m < last.length) {
    trail = last.splice(last.length - m, m)
  }

  const out: Ch[] = [...mirrored(trail)]

  parts.forEach((word, i) => {
    if (i > 0) {
      out.push({ c: ' ', s: 'plain' })
    }

    out.push(...word)
  })

  return [...out, ...mirrored(lead)]
}

const startsWithDigit = (chars: Ch[]): boolean =>
  /^\p{N}/u.test(chars.find(ch => ALNUM.test(ch.c))?.c ?? '')

const toSegments = (chars: Ch[]): Segment[] => {
  const segments: Segment[] = []

  for (const ch of chars) {
    const last = segments[segments.length - 1]

    if (last && last.style === ch.s) {
      last.text += ch.c
    } else {
      segments.push({ text: ch.c, style: ch.s })
    }
  }

  return segments
}

// A paragraph reads right to left when it has at least one Persian word,
// whatever it starts with; otherwise it keeps its own left-to-right order.
export const isRtl = (words: Word[]): boolean => words.some(w => scriptOf(w) === 'R')

// A left-to-right paragraph is emitted in logical order, which is how the
// terminal already shows it; the marker and the hanging indent are on the left.
const layoutLtr = (words: Word[], marker: string, isFirst: boolean, indent: number): Row => {
  const gap = marker ? cellWidth(marker) + 1 : 0
  const chars: Ch[] = [...NBSP.repeat(indent)].map(c => ({ c, s: 'plain' as Style }))

  chars.push(...[...(marker && isFirst ? marker + NBSP : NBSP.repeat(gap))].map(c => ({ c, s: 'plain' as Style })))

  words.forEach((word, i) => {
    if (i > 0) {
      chars.push({ c: ' ', s: 'plain' })
    }

    chars.push(...word)
  })

  const segments = toSegments(chars)

  return { segments, width: cellWidth(segments.map(x => x.text).join('')) }
}

// `marker` ("•", "1.") sits at the right edge of the first row; later rows keep
// the same gap there so a wrapped item hangs under its text.
export const layoutRow = (words: Word[], marker = '', isFirst = true, indent = 0, rtl = true): Row => {
  if (!rtl) {
    return layoutLtr(words, marker, isFirst, indent)
  }

  words = splitMixedWords(words)

  const scripts: Script[] = []
  const first = words.map(scriptOf).find(s => s) ?? 'R'
  const forced = codeSpanScripts(words)
  let previous: Script | null = null

  words.forEach((word, i) => {
    previous = forced.get(i) ?? scriptOf(word) ?? previous ?? first
    scripts.push(previous)
  })

  const runs: { script: Script; words: Word[] }[] = []

  words.forEach((word, i) => {
    if (i > 0 && scripts[i] === scripts[i - 1]) {
      runs[runs.length - 1]!.words.push(word)
    } else {
      runs.push({ script: scripts[i]!, words: [word] })
    }
  })

  // Brackets whose partner is in a different run.
  const flat: Ch[] = []
  const runOf = new Map<Ch, number>()

  runs.forEach((run, r) =>
    run.words.forEach(word => {
      if (flat.length) {
        flat.push({ c: ' ', s: 'plain' })
      }

      word.forEach(ch => {
        flat.push(ch)
        runOf.set(ch, r)
      })
    }),
  )

  const spanning = new Set<Ch>()

  matchBrackets(flat).forEach((j, i) => {
    if (runOf.get(flat[i]!) !== runOf.get(flat[j]!)) {
      spanning.add(flat[i]!)
      spanning.add(flat[j]!)
    }
  })

  const chars: Ch[] = []
  let laterRunGlued = false

  for (const run of runs.reverse()) {
    const body = runChars(run.words, run.script, spanning)

    if (chars.length) {
      const needsAnchor = run.script === 'L' && (startsWithDigit(body) || STRONG_RTL_PUNCTUATION.test(body[0]!.c))

      // Two pieces of one word are not separated: the later run (already
      // placed) begins with the piece that follows this run's last one.
      if (needsAnchor || !laterRunGlued) {
        chars.push({ c: needsAnchor ? L_ANCHOR : ' ', s: 'plain' })
      }
    }

    laterRunGlued = run.words[0]![0]!.g === true
    chars.push(...body)
  }

  const plain = (c: string): Ch => ({ c, s: 'plain' })
  const gap = marker ? cellWidth(marker) + 1 : 0
  const pad = NBSP.repeat(indent)

  if (marker && isFirst) {
    const tail = /^\p{N}/u.test(marker)
      ? [plain(L_ANCHOR), ...mirrored([...marker].map(c => ({ c, s: 'plain' as Style })))]
      : [plain(NBSP), ...[...marker].map(plain)]

    chars.push(...tail, ...[...pad].map(plain))
  } else if (gap || indent) {
    chars.push(...[...NBSP.repeat(gap) + pad].map(plain))
  }

  const segments = toSegments(chars)

  return { segments, width: cellWidth(segments.map(s => s.text).join('')) }
}
