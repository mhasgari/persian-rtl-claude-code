// Prints, as JSON, for each prose row of a text file: the row's logical text and
// the exact string the plugin hands the terminal for it.
//
//   bun tools/bidi-oracle/rows.ts text.md [columns] | python3 tools/bidi-oracle/icu.py
import { readFileSync } from 'node:fs'

import { isRtl, layoutRow, parseInline, wrapWords } from '../../hooks/bidi'
import type { Word } from '../../hooks/bidi'
import { toBlocks } from '../../hooks/register'

// The row's text as a reader would take it, with every code span wrapped in
// LRI..PDI: a code span is a literal, drawn as written and never reordered.
const logicalText = (words: Word[]): string => {
  let out = ''
  let inCode = false

  words.forEach((word, i) => {
    if (i > 0) {
      out += inCode && word[0]?.s === 'code' ? ' ' : (inCode ? '\u2069' : '') + ' '
      inCode = inCode && word[0]?.s === 'code'
    }

    for (const ch of word) {
      if (ch.s === 'code' && !inCode) {
        out += '\u2066'
        inCode = true
      } else if (ch.s !== 'code' && inCode) {
        out += '\u2069'
        inCode = false
      }

      out += ch.c
    }
  })

  return out + (inCode ? '\u2069' : '')
}

const text = readFileSync(process.argv[2]!, 'utf8')
const columns = Number(process.argv[3] ?? 114)
const out: { block: number; row: number; rtl: boolean; marker: string; logical: string; s: string }[] = []

toBlocks(text).forEach((block, b) => {
  if (block.kind !== 'prose') {
    return
  }

  const gap = block.marker ? block.marker.length + 1 : 0
  const words = parseInline(block.text, block.style)
  const rtl = isRtl(words)

  wrapWords(words, columns - gap - block.indent).forEach((line, r) => {
    const row = layoutRow(line, block.marker, r === 0, block.indent, rtl)

    out.push({
      block: b,
      row: r,
      rtl,
      marker: block.marker,
      logical: logicalText(line),
      s: row.segments.map(x => x.text).join(''),
    })
  })
})

console.log(JSON.stringify(out))
