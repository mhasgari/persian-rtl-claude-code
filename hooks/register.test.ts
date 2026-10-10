import { expect, test } from 'claude-code/testing'
import { hasPersian, isRtl, layoutRow, parseInline, plainWords } from './bidi'
import { callHeader, outputBlocks, resultSections, toBlocks } from './register'

const A = '⠀'
const N = ' '
const show = (s: string, marker = '', first = true, indent = 0) =>
  layoutRow(parseInline(s), marker, first, indent).segments.map(x => x.text).join('')

test('final period moves to the front of the row', () => {
  expect(show('باشه، منتظر نتیجه هستم.')).toBe('.باشه، منتظر نتیجه هستم')
})

test('runs are emitted in reverse order, Latin kept intact', () => {
  expect(show('این یک آزمایش با mod و Konsole است.')).toBe('.است Konsole و mod این یک آزمایش با')
})

test('trailing punctuation of a Latin word moves in front of it', () => {
  expect(show('از mod، سپاس')).toBe(['سپاس', '،mod', 'از'].join(' '))
})

test('a code word glued to punctuation keeps its own style', () => {
  const row = layoutRow(parseInline('`mod`، سلام'))
  expect(row.segments).toEqual([
    { text: 'سلام ،', style: 'plain' },
    { text: 'mod', style: 'code' },
  ])
})

test('a digit-initial Latin word after Persian text gets a left-to-right anchor', () => {
  expect(show('`6.png` را دیدم.')).toBe(`.را دیدم${A}6.png`)
})

test('a styled label stays first in reading order and keeps its style', () => {
  const row = layoutRow(parseInline('**نقطه:** متن'))
  expect(row.segments.map(s => s.text).join('')).toBe('نقطه: متن')
  expect(row.segments[0]).toEqual({ text: 'نقطه:', style: 'bold' })
})

test('bullet sits at the right edge, continuation rows hang', () => {
  expect(show('یک دو', '•', true)).toBe(`یک دو${N}•`)
  expect(show('سه چهار', '•', false)).toBe(`سه چهار${N}${N}`)
})

test('numbered marker is anchored so the digit stays at the edge', () => {
  expect(show('یک', '1.')).toBe(`یک${A}.1`)
})

test('code blocks and tables stay raw', () => {
  const kinds = toBlocks('سلام\n\n```\nx\n```\n| a | b |\n|---|---|').map(b => b.kind)
  expect(kinds).toEqual(['prose', 'blank', 'raw', 'raw'])
})

test('only text with a Persian character counts as Persian', () => {
  expect(hasPersian('abc س')).toBe(true)
  expect(hasPersian('abc 123 .')).toBe(false)
})

test('program output keeps every character and does not parse markdown', () => {
  const words = plainWords('**a** `b` سلام')
  expect(words.map(w => w.map(c => c.c).join(''))).toEqual(['**a**', '`b`', 'سلام'])
  expect(words.every(w => w.every(c => c.s === 'plain'))).toBe(true)
})

test('output is capped and says how many lines were left out', () => {
  const blocks = outputBlocks(Array.from({ length: 70 }, (_, i) => `سطر ${i}`).join('\n'))
  expect(blocks).toHaveLength(61)
  expect(blocks[60]).toMatchObject({ text: '… +10 lines' })
})

test('a tool result is text only where its shape is known', () => {
  expect(resultSections({ stdout: 'سلام', stderr: '' })).toEqual([{ text: 'سلام', mode: 'output' }])
  expect(resultSections({ file: { content: 'متن' } })).toEqual([{ text: 'متن', mode: 'output' }])
  expect(resultSections({ stdout: 'a', stderr: 'خطا' })).toEqual([
    { text: 'a', mode: 'output' },
    { text: 'خطا', mode: 'output', color: 'red' },
  ])
  expect(resultSections({ structuredPatch: [] })).toEqual([])
})

test('a tool call header names the tool and its main argument', () => {
  expect(callHeader('Bash', { command: 'echo سلام', description: 'x' })).toBe('Bash(echo سلام)')
  expect(callHeader('Read', { file_path: '/a/b.md' })).toBe('Read(/a/b.md)')
  expect(callHeader('Custom', { n: 1 })).toBe('Custom({"n":1})')
})

test('brackets inside a Persian run are swapped, because the terminal does not mirror them', () => {
  expect(show('اگر ارقام فارسی (۱۲۳) خواستید')).toBe('اگر ارقام فارسی )۱۲۳( خواستید')
})

test('brackets in Latin text and in code are left alone', () => {
  expect(show('از `f(x)` و mod(1) استفاده کن')).toContain('f(x)')
  expect(show('از `f(x)` و mod(1) استفاده کن')).toContain('mod(1)')
})

test('a paragraph without Persian keeps its own order and its final period', () => {
  const words = parseInline("Explicitly requested, so I'll edit it.")
  expect(isRtl(words)).toBe(false)
  expect(layoutRow(words, '', true, 0, false).segments.map(s => s.text).join('')).toBe("Explicitly requested, so I'll edit it.")
})

test('one Persian word makes the whole paragraph right to left, even when it starts in Latin', () => {
  expect(isRtl(parseInline('mod خودکار reload می‌شود.'))).toBe(true)
})

test('a left-to-right list item has its marker on the left and hangs there', () => {
  const words = parseInline('first item')
  expect(layoutRow(words, '•', true, 0, false).segments.map(s => s.text).join('')).toBe(`•${N}first item`)
  expect(layoutRow(words, '•', false, 0, false).segments.map(s => s.text).join('')).toBe(`${N}${N}first item`)
})

test('a bracket pair inside one word stays together and is not treated as punctuation', () => {
  expect(show('تابع mod(1) خوب است')).toBe(['خوب است', 'mod(1)', 'تابع'].join(' '))
  expect(show('(سلام) دنیا')).toBe(')سلام( دنیا')
})
