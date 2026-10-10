// A markdown table laid out for a right-to-left reader: the first column on the
// right, every cell laid out like a paragraph of its own, Persian cells flush
// right in their column. Claude Code draws a table left to right, first column on
// the left, with each cell reordered by the terminal on its own, which is wrong for
// Persian; so a table with Persian in it is drawn here, with box characters.
import { cellWidth, hasPersian, isRtl, layoutRow, parseInline, wrapWords } from './bidi'
import type { Segment, Word } from './bidi'

export type Table = { header: string[]; rows: string[][] }

// A blank cell of a left-to-right character, used where a space would be: a cell is
// then a set of runs of its own whether or not the terminal cuts the line at the
// borders.
const ANCHOR = '⠀'
const NBSP = ' '
const MIN_COLUMN = 6

const splitCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim().replace(/\\\|/g, '|'))

// The header, the dash row and the body, or null where the lines are no table (no
// dash row under the header): the caller then leaves them to the engine.
export const parseTable = (lines: string[]): Table | null => {
  if (lines.length < 2) {
    return null
  }

  const rows = lines.map(splitCells)

  if (!rows[1]!.every(cell => /^:?-+:?$/.test(cell))) {
    return null
  }

  const columns = Math.max(...rows.map(row => row.length))
  const even = (row: string[]): string[] => Array.from({ length: columns }, (_, i) => row[i] ?? '')

  return { header: even(rows[0]!), rows: rows.slice(2).map(even) }
}

const plain = (text: string): Segment => ({ text, style: 'plain' })

// Where a Persian cell lays itself out right to left and a cell without Persian
// keeps its own order; both stand flush right in a column that has Persian.
const cellOf = (words: Word[], width: number, flushRight: boolean) => {
  const rtl = isRtl(words)
  const lines = (words.length ? wrapWords(words, width) : [[]]).map(line => layoutRow(line, '', true, 0, rtl))

  return { lines, flushRight }
}

export const layoutTable = (table: Table, available: number): Segment[][] | null => {
  const all = [table.header, ...table.rows]

  if (!all.some(row => row.some(hasPersian))) {
    return null
  }

  const columns = table.header.length
  const words = all.map((row, r) => row.map(cell => parseInline(cell, r === 0 ? 'bold' : 'plain')))

  // The width each column would take on one line.
  const natural = Array.from({ length: columns }, (_, c) =>
    Math.max(...words.map(row => (row[c]!.length ? layoutRow(row[c]!, '', true, 0, isRtl(row[c]!)).width : 0)), 1),
  )

  // Borders and the blank cell on either side of a cell: columns + 1 + 2 per column.
  const budget = available - (3 * columns + 1)
  const widths = [...natural]

  while (widths.reduce((a, b) => a + b, 0) > budget) {
    const widest = widths.indexOf(Math.max(...widths))

    if (widths[widest]! <= MIN_COLUMN) {
      break
    }

    widths[widest]!--
  }

  const flushRight = Array.from({ length: columns }, (_, c) => all.some(row => hasPersian(row[c]!)))
  const bar = (left: string, join: string, right: string): Segment[] => [
    plain(left + widths.map(w => '─'.repeat(w + 2)).reverse().join(join) + right),
  ]
  const out: Segment[][] = [bar('┌', '┬', '┐')]

  words.forEach((row, r) => {
    const cells = row.map((cellWords, c) => cellOf(cellWords, widths[c]!, flushRight[c]!))
    const height = Math.max(...cells.map(cell => cell.lines.length))

    for (let line = 0; line < height; line++) {
      const segments: Segment[] = [plain('│')]

      // first column on the right: last column first
      for (let c = columns - 1; c >= 0; c--) {
        const laid = cells[c]!.lines[line]
        const free = widths[c]! - (laid?.width ?? 0)
        const before = cells[c]!.flushRight ? free : 0

        segments.push(plain(ANCHOR + NBSP.repeat(before)), ...(laid?.segments ?? []), plain(NBSP.repeat(free - before) + ANCHOR + '│'))
      }

      out.push(segments)
    }

    if (r === 0) {
      out.push(bar('├', '┼', '┤'))
    }
  })

  out.push(bar('└', '┴', '┘'))

  return out
}

export const tableWidth = (lines: Segment[][]): number => cellWidth(lines[0]!.map(s => s.text).join(''))
