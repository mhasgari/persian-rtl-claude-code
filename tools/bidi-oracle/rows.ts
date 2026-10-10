// Prints, as JSON, for each prose row of a text file: the row's logical text and
// the exact string the plugin hands the terminal for it.
//
//   bun tools/bidi-oracle/rows.ts text.md [columns] | python3 tools/bidi-oracle/icu.py
import { readFileSync } from 'node:fs'

import { isRtl, layoutRow, parseInline, wrapWords } from '../../hooks/bidi'
import { toBlocks } from '../../hooks/register'

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
      logical: line.map(w => w.map(c => c.c).join('')).join(' '),
      s: row.segments.map(x => x.text).join(''),
    })
  })
})

console.log(JSON.stringify(out))
