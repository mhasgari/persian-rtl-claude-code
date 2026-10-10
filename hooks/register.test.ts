import { expect, test } from 'claude-code/testing'
import { layoutRow, parseInline } from './bidi'
import { toBlocks } from './register'

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
