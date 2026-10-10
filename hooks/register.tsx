import type { Register } from 'claude-code'

import { hasPersian, layoutRow, parseInline, plainWords, wrapWords } from './bidi'
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
// does not become thousands of elements.
const MAX_OUTPUT_LINES = 60

export const outputBlocks = (text: string): Block[] => {
  const lines = text.replace(/\n+$/, '').split('\n')
  const shown = lines.slice(0, MAX_OUTPUT_LINES)
  const blocks: Block[] = shown.map(line => ({ kind: 'prose', text: line, marker: '', indent: 0, style: 'plain' }))

  if (lines.length > shown.length) {
    blocks.push({ kind: 'prose', text: `… +${lines.length - shown.length} lines`, marker: '', indent: 0, style: 'plain' })
  }

  return blocks
}

type Mode = 'markdown' | 'output'

// `bash` is the one tool result whose shape is known: { stdout, stderr }.
const bashText = (output: unknown): { out: string; err: string } => {
  const { stdout, stderr } = (output ?? {}) as { stdout?: unknown; stderr?: unknown }

  return { out: typeof stdout === 'string' ? stdout : '', err: typeof stderr === 'string' ? stderr : '' }
}

export const register: Register = on => {
  for (const component of ['AssistantMessage', 'UserMessage', 'CommandOutput', 'ToolResult'] as const) {
    on('ui.render', { component }, ($, e, next) => {
      const props = e.props as Record<string, unknown>
      const sections: { text: string; mode: Mode; color?: string }[] = []

      if (component === 'ToolResult') {
        if (props.tool !== 'Bash' || props.isErrored === true) {
          return next(e)
        }

        const { out, err } = bashText(props.output)

        if (!hasPersian(out + err)) {
          return next(e)
        }

        if (out.trim()) {
          sections.push({ text: out, mode: 'output' })
        }

        if (err.trim()) {
          sections.push({ text: err, mode: 'output', color: 'red' })
        }
      } else if (typeof props.text === 'string' && props.text.length <= 10000) {
        // Messages are always laid out right to left; other rows only when
        // they hold at least one Persian character.
        if (component === 'CommandOutput' && !hasPersian(props.text)) {
          return next(e)
        }

        sections.push({ text: props.text, mode: 'markdown' })
      } else {
        return next(e)
      }

      const { Box, Text, Markdown } = $.ui.resolve(e)
      const columns = Math.max(24, (e.viewport?.columns ?? 80) - 6)
      const rows: unknown[] = []

      sections.forEach((section, k) => {
        const blocks = section.mode === 'markdown' ? toBlocks(section.text) : outputBlocks(section.text)

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

          wrapWords(words, columns - gap - block.indent).forEach((line, r) => {
            const row: Row = layoutRow(line, block.marker, r === 0, block.indent)

            rows.push(
              <Box key={`${key}r${r}`} alignSelf="flex-end" flexDirection="row">
                {row.segments.map((s, i) => (
                  <Text
                    key={String(i)}
                    bold={s.style === 'bold'}
                    italic={s.style === 'italic'}
                    color={s.style === 'code' ? 'cyan' : section.color}
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
