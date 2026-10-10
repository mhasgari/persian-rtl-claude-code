import type { Register } from 'claude-code'

import { layoutRow, parseInline, wrapWords } from './bidi'
import type { Style } from './bidi'

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

export const register: Register = on => {
  for (const component of ['AssistantMessage', 'UserMessage'] as const) {
    on('ui.render', { component }, ($, e, next) => {
      const text = e.props.text

      if (typeof text !== 'string') {
        return next(e)
      }

      const { Box, Text, Markdown } = $.ui.resolve(e)
      const columns = Math.max(24, (e.viewport?.columns ?? 80) - 6)
      const rows: unknown[] = []

      toBlocks(text).forEach((block, b) => {
        if (block.kind === 'blank') {
          rows.push(<Text key={`b${b}`}> </Text>)

          return
        }

        if (block.kind === 'raw') {
          rows.push(
            <Box key={`b${b}`} alignSelf="flex-start" width="100%">
              <Markdown text={block.text} />
            </Box>,
          )

          return
        }

        const gap = block.marker ? block.marker.length + 1 : 0
        const lines = wrapWords(parseInline(block.text, block.style), columns - gap - block.indent)

        lines.forEach((words, r) => {
          const row = layoutRow(words, block.marker, r === 0, block.indent)

          rows.push(
            <Box key={`b${b}r${r}`} alignSelf="flex-end" flexDirection="row">
              {row.segments.map((s, i) => (
                <Text
                  key={String(i)}
                  bold={s.style === 'bold'}
                  italic={s.style === 'italic'}
                  color={s.style === 'code' ? 'cyan' : undefined}
                >
                  {s.text}
                </Text>
              ))}
            </Box>,
          )
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
