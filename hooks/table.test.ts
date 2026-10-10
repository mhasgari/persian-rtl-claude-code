import { expect, test } from 'claude-code/testing'
import { cellWidth } from './bidi'
import { layoutTable, parseTable } from './table'

const lines = (md: string, width = 200): string[] | null => {
  const table = parseTable(md.trim().split('\n'))
  const out = table && layoutTable(table, width)

  return out && out.map(segments => segments.map(s => s.text).join(''))
}

const FA = `
| نام | مقدار |
| --- | --- |
| mod | ۱۲۳ |
| reload | 456 |
`

test('a table is its header, its dash row and its body', () => {
  expect(parseTable(['| a | b |', '| --- | :-: |', '| 1 | 2 |', '| 3 |'])).toEqual({
    header: ['a', 'b'],
    rows: [
      ['1', '2'],
      ['3', ''],
    ],
  })
})

test('an escaped pipe is part of a cell', () => {
  expect(parseTable(['| a \\| b | c |', '| - | - |'])!.header).toEqual(['a | b', 'c'])
})

test('lines without a dash row under the first are no table', () => {
  expect(parseTable(['| a | b |', '| 1 | 2 |'])).toBeNull()
  expect(parseTable(['| a | b |'])).toBeNull()
})

test('a table with no Persian in it is left to the engine', () => {
  expect(lines('| a | b |\n| - | - |\n| 1 | 2 |')).toBeNull()
})

test('the first column stands on the right, the last on the left', () => {
  const drawn = lines(FA)!
  const header = drawn[1]!

  expect(header.indexOf('مقدار')).toBeLessThan(header.indexOf('نام'))
})

test('every line of the table is as wide as the border', () => {
  const drawn = lines(FA)!
  const widths = new Set(drawn.map(cellWidth))

  expect([...widths]).toHaveLength(1)
})

test('a Persian cell is flush right in its column, a Latin one too', () => {
  const header = lines(FA)![1]!
  const first = lines(FA)![3]!

  // "mod" is shorter than the column and stands at its right edge: blanks before it
  expect(first).toContain('   mod⠀│')
  expect(header).toContain('   نام⠀│')
})

test('a table too wide for the terminal gives its cells several lines', () => {
  const md = `
| ویژگی | توضیح کامل و طولانی برای آزمایش شکستن سلول |
| --- | --- |
| راست‌چین | پیام‌ها و جدول‌ها از راست به چپ چیده می‌شوند |
`
  const wide = lines(md, 200)!
  const narrow = lines(md, 40)!

  expect(narrow.length).toBeGreaterThan(wide.length)
  expect(new Set(narrow.map(cellWidth)).size).toBe(1)
})

test('the borders are box characters with a junction for every column', () => {
  const drawn = lines(FA)!

  expect(drawn[0]).toMatch(/^┌─+┬─+┐$/)
  expect(drawn[2]).toMatch(/^├─+┼─+┤$/)
  expect(drawn[drawn.length - 1]).toMatch(/^└─+┴─+┘$/)
})
