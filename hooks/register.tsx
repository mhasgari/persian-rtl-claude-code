import type { Register } from 'claude-code'

import { hasPersian, isRtl, layoutRow, parseInline, plainWords, wrapWords } from './bidi'
import { PROGRESS_NOTES, PROGRESS_NOTES_ID } from './progress-notes'
import type { Row, Style, Word } from './bidi'

type Block =
  | { kind: 'raw'; text: string }
  | { kind: 'blank' }
  | { kind: 'prose'; text: string; marker: string; indent: number; style: Style }

export const toBlocks = (text: string): Block[] => {
  const blocks: Block[] = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (/^\s*(```|~~~)/.test(line)) {
      const fence: string[] = [line]

      while (++i < lines.length) {
        fence.push(lines[i]!)

        if (/^\s*(```|~~~)\s*$/.test(lines[i]!)) {
          break
        }
      }

      blocks.push({ kind: 'raw', text: fence.join('\n') })
    } else if (/^\s*\|/.test(line)) {
      const table: string[] = [line]

      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1]!)) {
        table.push(lines[++i]!)
      }

      blocks.push({ kind: 'raw', text: table.join('\n') })
    } else if (!line.trim()) {
      if (blocks.length && blocks[blocks.length - 1]!.kind !== 'blank') {
        blocks.push({ kind: 'blank' })
      }
    } else {
      const heading = /^\s*#{1,6}\s+(.*)$/.exec(line)
      const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
      const quote = /^\s*>\s?(.*)$/.exec(line)

      if (heading) {
        blocks.push({ kind: 'prose', text: heading[1]!, marker: '', indent: 0, style: 'bold' })
      } else if (item) {
        const marker = /^\d/.test(item[2]!) ? item[2]! : '•'
        const indent = Math.floor(item[1]!.length / 2) * 2
        blocks.push({ kind: 'prose', text: item[3]!, marker, indent, style: 'plain' })
      } else if (quote) {
        blocks.push({ kind: 'prose', text: quote[1]!, marker: '▎', indent: 0, style: 'plain' })
      } else {
        blocks.push({ kind: 'prose', text: line, marker: '', indent: 0, style: 'plain' })
      }
    }
  }

  return blocks
}

// Program output: one block per line, nothing parsed, capped so a huge result
// does not become thousands of elements. `marker` goes on the first line.
const MAX_OUTPUT_LINES = 60

export const outputBlocks = (text: string, marker = ''): Block[] => {
  const lines = text.replace(/\n+$/, '').split('\n')
  const shown = lines.slice(0, MAX_OUTPUT_LINES)
  const blocks: Block[] = shown.map((line, i) => ({
    kind: 'prose',
    text: line,
    marker: i === 0 ? marker : '',
    indent: 0,
    style: 'plain',
  }))

  if (lines.length > shown.length) {
    blocks.push({ kind: 'prose', text: `… +${lines.length - shown.length} lines`, marker: '', indent: 0, style: 'plain' })
  }

  return blocks
}

type Mode = 'markdown' | 'output'
type Section = { text: string; mode: Mode; color?: string; dim?: boolean; marker?: string }

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

// A tool's result is text for Bash ({ stdout, stderr }) and for the tools that
// carry their text in one well-known field (Read's file.content, Grep's
// content ...). Anything else (a diff, a structured result) is left to the
// engine, which draws it better than a flat list of lines could.
export const resultSections = (output: unknown): Section[] => {
  if (typeof output === 'string') {
    return [{ text: output, mode: 'output' }]
  }

  const o = (output ?? {}) as Record<string, unknown>
  const file = (o.file ?? {}) as Record<string, unknown>
  const sections: Section[] = []
  const main = [o.stdout, o.content, file.content, o.text, o.result, o.output].map(asText).find(t => t.trim())

  if (main) {
    sections.push({ text: main, mode: 'output' })
  }

  if (asText(o.stderr).trim()) {
    sections.push({ text: asText(o.stderr), mode: 'output', color: 'red' })
  }

  return sections
}

// The one-line header of a tool call: its name and the argument that says what
// it does.
export const callHeader = (tool: string, input: unknown): string => {
  const o = (input ?? {}) as Record<string, unknown>
  const key = ['command', 'description', 'file_path', 'path', 'pattern', 'query', 'prompt', 'url'].find(k =>
    asText(o[k]).trim(),
  )
  const arg = (key ? asText(o[key]) : JSON.stringify(input) ?? '').replace(/\s+/g, ' ').trim()

  return `${tool}(${arg.length > 200 ? `${arg.slice(0, 200)}…` : arg})`
}

export const register: Register = (on, options) => {
  // On unless the user turned it off: the summaries of the text between tool calls
  // can only be read the right way round if that text is English (see progress-notes.ts).
  if (options.englishProgressNotes !== false) {
    on('prompt.compose', async ($, e, next) => {
      const result = await next(e)

      return {
        ...result,
        sections: [...result.sections, { id: PROGRESS_NOTES_ID, text: PROGRESS_NOTES, scope: 'session' }],
      }
    })
  }

  for (const component of [
    'AssistantMessage',
    'UserMessage',
    'CommandOutput',
    'InfoNotice',
    'ToolUse',
    'ToolResult',
  ] as const) {
    on('ui.render', { component }, ($, e, next) => {
      const props = e.props as Record<string, unknown>
      let sections: Section[] = []

      if (component === 'ToolResult') {
        if (props.isErrored === true) {
          return next(e)
        }

        sections = resultSections(props.output)
      } else if (component === 'ToolUse') {
        sections = [
          {
            text: callHeader(asText(props.tool), props.input),
            mode: 'output',
            marker: '●',
            color: props.isErrored === true ? 'red' : undefined,
            dim: props.isRunning === true,
          },
        ]
      } else if (typeof props.text === 'string' && props.text.length <= 10000) {
        sections = [{ text: props.text, mode: 'markdown', dim: component === 'InfoNotice' }]
      }

      // Whatever holds no Persian character at all is left to the engine, which
      // draws it left to right with its bullet and markdown. A paragraph of a
      // mixed text that has none is drawn left-aligned below.
      const persian = component === 'ToolUse' ? hasPersian(JSON.stringify(props.input) ?? '') : sections.some(x => hasPersian(x.text))

      if (!sections.length || !persian) {
        return next(e)
      }

      const { Box, Text, Markdown } = $.ui.resolve(e)
      const columns = Math.max(24, (e.viewport?.columns ?? 80) - 6)
      const rows: unknown[] = []

      sections.forEach((section, k) => {
        const blocks =
          section.mode === 'markdown' ? toBlocks(section.text) : outputBlocks(section.text, section.marker)

        blocks.forEach((block, b) => {
          const key = `s${k}b${b}`

          if (block.kind === 'blank') {
            rows.push(<Text key={key}> </Text>)

            return
          }

          if (block.kind === 'raw') {
            rows.push(
              <Box key={key} alignSelf="flex-start" width="100%">
                <Markdown text={block.text} />
              </Box>,
            )

            return
          }

          const gap = block.marker ? block.marker.length + 1 : 0
          const words: Word[] =
            section.mode === 'markdown' ? parseInline(block.text, block.style) : plainWords(block.text)

          if (!words.length) {
            rows.push(<Text key={key}> </Text>)

            return
          }

          const rtl = isRtl(words)

          wrapWords(words, columns - gap - block.indent).forEach((line, r) => {
            const row: Row = layoutRow(line, block.marker, r === 0, block.indent, rtl)

            rows.push(
              <Box key={`${key}r${r}`} alignSelf={rtl ? 'flex-end' : 'flex-start'} flexDirection="row">
                {row.segments.map((s, i) => (
                  <Text
                    key={String(i)}
                    bold={s.style === 'bold'}
                    italic={s.style === 'italic'}
                    color={s.style === 'code' ? 'cyan' : section.color}
                    dimColor={section.dim}
                  >
                    {s.text}
                  </Text>
                ))}
              </Box>,
            )
          })
        })
      })

      return (
        <Box flexDirection="column" alignItems="flex-end" width="100%">
          {rows}
        </Box>
      )
    })
  }
}
