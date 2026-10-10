// Konsole runs the Unicode bidi algorithm over the whole row with a
// left-to-right base direction. Zero-width controls (RLM, LRM) are folded into
// the previous cell and ignored; embeddings and isolates draw as "?". So the
// visual order is computed here: the text is split into rows, each row into
// Persian and Latin runs, and the runs are emitted in reverse. The terminal
// then reverses the letters inside each Persian run itself, which leaves the
// row reading right to left. Styles ride on single characters, so they never
// affect the order.

export type Style = 'plain' | 'bold' | 'italic' | 'code'
export type Ch = { c: string; s: Style }
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
const ALNUM = /[\p{L}\p{N}]/u
const ZERO_WIDTH = /[​-‏‪-‮ً-ٰٟ]/
const LEAD = /[«(\[{"“‘<]/
const TRAIL = /[.,،؛;:!?؟…»)\]}"”’>]/
const MIRROR: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '«': '»', '»': '«', '<': '>', '>': '<',
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

  while (m < chars.length && TRAIL.test(chars[chars.length - 1 - m]!.c) && chars[chars.length - 1 - m]!.s !== 'code') {
    m++
  }

  const trail = m < chars.length ? chars.splice(chars.length - m, m) : []

  return [...mirrored(trail), ...chars, ...mirrored(lead)]
}

const runChars = (words: Word[], script: Script): Ch[] => {
  if (script === 'R' && startsWithDigit(words[0]!)) {
    const [number, ...rest] = words

    return rest.length
      ? [...runChars(rest, script), { c: L_ANCHOR, s: 'plain' }, ...numberChars(number!)]
      : numberChars(number!)
  }

  const parts = words.map(w => [...w])
  const first = parts[0]!
  const last = parts[parts.length - 1]!
  let lead: Ch[] = []
  let trail: Ch[] = []

  if (first.length && last.length) {
    let n = 0

    while (n < first.length && LEAD.test(first[n]!.c) && first[n]!.s !== 'code' && !(script === 'L' && isPaired(words[0]!, first[n]!.c))) {
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
      !(script === 'L' && isPaired(words[words.length - 1]!, last[last.length - 1 - m]!.c))
    ) {
      m++
    }

    if (m < last.length) {
      trail = last.splice(last.length - m, m)
    }
  }

  const out: Ch[] = [...mirrored(trail)]

  parts.forEach((word, i) => {
    if (i > 0) {
      out.push({ c: ' ', s: 'plain' })
    }

    // Konsole reverses the letters of a Persian run but does not mirror
    // brackets, so one inside the run is swapped to come out facing right.
    out.push(...(script === 'R' ? swapped(word) : word))
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

  const scripts: Script[] = []
  const first = words.map(scriptOf).find(s => s) ?? 'R'
  let previous: Script | null = null

  for (const word of words) {
    previous = scriptOf(word) ?? previous ?? first
    scripts.push(previous)
  }

  const runs: { script: Script; words: Word[] }[] = []

  words.forEach((word, i) => {
    if (i > 0 && scripts[i] === scripts[i - 1]) {
      runs[runs.length - 1]!.words.push(word)
    } else {
      runs.push({ script: scripts[i]!, words: [word] })
    }
  })

  const chars: Ch[] = []

  for (const run of runs.reverse()) {
    const body = runChars(run.words, run.script)

    if (chars.length) {
      const needsAnchor = run.script === 'L' && startsWithDigit(body)
      chars.push({ c: needsAnchor ? L_ANCHOR : ' ', s: 'plain' })
    }

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
