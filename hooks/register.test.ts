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

test('a number that starts a Persian run is placed after it behind an anchor', () => {
  expect(show('۷. لیست‌ها:')).toBe(`:لیست‌ها${A}.۷`)
})

test('a numbered label after Latin text keeps its number at the right edge', () => {
  expect(show('۳. کلمات `6.png` را')).toBe(`را${A}6.png کلمات${A}.۳`)
})

// Each expected string below was checked against ICU's bidi (what Konsole runs)
// with tools/bidi-oracle: drawn there it equals a correct right-to-left layout.

test('a bracket whose partner is in a Latin run and that sits inside a Persian run splits it', () => {
  expect(show('در (Konsole یا دیگر) را اجرا کردم.')).toBe(`.را اجرا کردم (یا دیگر Konsole) در`)
})

test('a question mark after a Latin word moves to its front', () => {
  expect(show('آیا Konsole؟')).toBe(`؟Konsole آیا`)
})

test('a question mark after a number keeps its place in the run', () => {
  expect(show('آیا ۷؟')).toBe(`آیا ۷؟`)
})

test('punctuation after a bracket group travels with the group', () => {
  expect(show('مثال (ساده)، مثال (دیگر).')).toBe(`.(دیگر) مثال${A}،(ساده) مثال`)
})

test('quotes around a bracket group travel with it', () => {
  expect(show('او «(نقل)» گفت.')).toBe(`.گفت${A}«(نقل)» او`)
})

test('a bracket group inside Persian text is an island behind an anchor', () => {
  expect(show('اگر ارقام فارسی (۱۲۳) خواستید.')).toBe(`.خواستید${A}(۱۲۳) اگر ارقام فارسی`)
})

test('several groups on one side of a Latin word stay apart', () => {
  expect(show('پلاگین persian-rtl نسخه‌ی ۰٫۱٫۰ و (۱۲۳) مورد و (456) مورد.')).toBe(`.مورد${A}(456) مورد و${A}(۱۲۳) نسخه\u200cی ۰٫۱٫۰ و persian-rtl پلاگین`)
})

test('a group on the other side of a Latin word keeps its order', () => {
  expect(show('در (نسخه‌ی 2.1.289) پلاگین persian-rtl آزمایش شد.')).toBe(`.آزمایش شد persian-rtl پلاگین${A}(نسخه\u200cی 2.1.289) در`)
})

test('Latin words with digits and brackets stay whole', () => {
  expect(show('فایل `6.png` و تابع `mod(1)` را دیدم.')).toBe(`.را دیدم mod(1) و تابع${A}6.png فایل`)
})

test('a number alone after a question mark gets an anchor so it stays apart', () => {
  expect(show('۷؟')).toBe(`؟${A}۷`)
})

test('a bracket pair inside one Latin word is not moved', () => {
  expect(show('تابع mod(1) خوب است')).toBe(['خوب است', 'mod(1)', 'تابع'].join(' '))
})
