//   bun tools/bidi-oracle/table.ts table.md [columns] > t.json && python3 tools/bidi-oracle/table.py t.json
//
// For a table: the string each line hands the terminal, and for each cell the lines it was cut into, as
// logical text (what the reader meets), so a check can compare cell by cell.
import { layoutTable, parseTable } from '../../hooks/table'
import { parseInline, wrapWords } from '../../hooks/bidi'
import { readFileSync } from 'node:fs'

const md = readFileSync(process.argv[2]!, 'utf8').trim().split('\n')
const width = Number(process.argv[3] ?? 200)
const table = parseTable(md)!
const lines = layoutTable(table, width)!

// the width each column was given: read off the first border line
const widths = lines[0]![0]!.text.slice(1, -1).split('┬').map(b => b.length - 2).reverse()

const cellLines = [table.header, ...table.rows].map((row, r) =>
  row.map((cell, c) => {
    const words = parseInline(cell, r === 0 ? 'bold' : 'plain')

    return (words.length ? wrapWords(words, widths[c]!) : [[]]).map(l => l.map(w => w.map(ch => ch.c).join('')).join(' '))
  }),
)

console.log(JSON.stringify({ lines: lines.map(l => l.map(s => s.text).join('')), cellLines }))
