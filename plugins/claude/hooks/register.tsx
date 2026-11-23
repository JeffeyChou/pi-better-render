/**
 * better-render for Claude Code: draws assistant text blocks that hold
 * formulas or tables with the pi-better-render core.
 *
 * Display only. The hook answers `ui.render` for `AssistantMessage`, which
 * changes the drawing and nothing else: the reply as stored, the transcript
 * and what the model reads keep the original Markdown. Blocks without math
 * or tables, other surfaces than the terminal, and any failure fall through
 * to Claude Code's own drawing.
 *
 * A text block is rendered once it is complete (Claude Code hands this hook
 * finished blocks), not while it streams.
 */
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import {
  engineStatus,
  formulaAlt,
  MATH_COLORS,
  renderText,
  start,
  themeAppearance,
  visibleWidth,
  type Part,
  type Row,
  type Segment,
  type TextRun,
} from '../lib/better-render.mjs'

type Images = 'auto' | 'on' | 'off'

interface Settings {
  images: boolean
  mathColor: string
  cellAspect: number
  why: string
}

/** Claude Code indents a reply's text by two columns, past its bullet. */
const GUTTER = 2

function terminalHasImages(env: Record<string, string | undefined>): { images: boolean; why: string } {
  // Claude Code's Image element draws with the kitty graphics protocol (kitty, Ghostty); inside tmux
  // only with passthrough, which nothing here can check.
  if (env.TMUX) return { images: false, why: 'inside tmux' }
  if (env.TERM_PROGRAM === 'ghostty' || env.TERM === 'xterm-ghostty' || env.GHOSTTY_RESOURCES_DIR)
    return { images: true, why: 'Ghostty' }
  if (env.TERM === 'xterm-kitty' || env.KITTY_WINDOW_ID) return { images: true, why: 'kitty' }
  return { images: false, why: `no kitty graphics (${env.TERM_PROGRAM ?? env.TERM ?? 'unknown terminal'})` }
}

/** Claude Code's `theme`: from settings, else its global config file, where `/theme` stores it. */
async function readTheme($: EngineInterface): Promise<string | undefined> {
  try {
    const theme = await $.settings.read({ key: 'theme' })
    if (typeof theme === 'string') return theme
  } catch {
    // fall through to the config file
  }
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  for (const file of [configDir && `${configDir}/.claude.json`, home && `${home}/.claude.json`]) {
    if (!file) continue
    try {
      // The file can be large; the theme sits among the top-level keys, and a 4 MiB read covers it.
      const text = await $.fs.read(file, { length: 4 * 1024 * 1024 })
      const match = /"theme"\s*:\s*"([\w-]+)"/.exec(text)
      if (match) return match[1]
    } catch {
      // no such file
    }
  }
  return undefined
}

async function readSettings($: EngineInterface, options: Record<string, unknown>): Promise<Settings> {
  const mode = (['auto', 'on', 'off'].includes(String(options.images)) ? options.images : 'auto') as Images
  const env = {
    TMUX: await $.env.get('TMUX'),
    TERM: await $.env.get('TERM'),
    TERM_PROGRAM: await $.env.get('TERM_PROGRAM'),
    GHOSTTY_RESOURCES_DIR: await $.env.get('GHOSTTY_RESOURCES_DIR'),
    KITTY_WINDOW_ID: await $.env.get('KITTY_WINDOW_ID'),
  }
  const detected = terminalHasImages(env)
  const images = mode === 'on' ? true : mode === 'off' ? false : detected.images
  const why = mode === 'auto' ? detected.why : `images: ${mode}`
  const theme = await readTheme($)
  // `auto` follows the terminal; COLORFGBG ("fg;bg", 7 and 9-15 light) is the one hint a mod can read.
  const bg = (await $.env.get('COLORFGBG'))?.split(';').pop()
  const appearance =
    theme === 'auto' && bg && /^\d+$/.test(bg) ? (+bg === 7 || (+bg >= 9 && +bg <= 15) ? 'light' : 'dark') : themeAppearance(theme)
  const color =
    typeof options.formulaColor === 'string' && /^#[0-9a-f]{6}$/i.test(options.formulaColor)
      ? options.formulaColor
      : MATH_COLORS[appearance]
  const aspect =
    typeof options.cellAspect === 'number' && options.cellAspect >= 1.2 && options.cellAspect <= 4
      ? options.cellAspect
      : 2.1
  return { images, mathColor: color, cellAspect: aspect, why }
}

let settings: Promise<Settings> | undefined
let lastError: string | undefined

function ensureEngine($: EngineInterface): Promise<boolean> {
  return start({
    wasm: () => $.wasm.compile('../lib/resvg.wasm'),
    readGlyphs: async (name: string) =>
      JSON.parse(await $.fs.read(`${$.plugin.root}/lib/glyphs/${name}.json`)) as unknown[],
  })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    settings = readSettings($, options)
    await $.command.register({
      name: 'better-render',
      description: 'Show how better-render draws formulas and tables',
    })
    return next(e)
  })

  on('command.run', { command: 'better-render' }, async $ => {
    const s = await (settings ??= readSettings($, options))
    let engine: string
    try {
      await ensureEngine($)
      engine = engineStatus()
    } catch (error) {
      engine = `unavailable (${String(error)})`
    }
    return {
      text: [
        `better-render: formulas ${s.images ? 'as images' : 'as text'} (${s.why}); tables and formulas drawn by the pi-better-render core`,
        `math engine: ${engine}`,
        `formula color: ${s.mathColor}   cell aspect: ${s.cellAspect}`,
        lastError ? `last error: ${lastError}` : 'last error: none',
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary) return next(e)
    const columns = e.viewport?.columns
    if (!columns) return next(e)
    try {
      const s = await (settings ??= readSettings($, options))
      await ensureEngine($)
      const plan = await renderText(e.props.text, {
        width: Math.max(20, columns - GUTTER),
        images: s.images,
        mathColor: s.mathColor,
        cellAspect: s.cellAspect,
      })
      if (!plan.rich) return next(e)
      return draw($, e, plan.parts)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      return next(e)
    }
  }).catch(($, e, next) => next(e))
}

type TerminalInput = Extract<RenderInput<'AssistantMessage'>, { surface: 'terminal' }>

function draw($: EngineInterface, e: TerminalInput, parts: Part[]) {
  const { Box, Text, Image, Markdown } = $.ui.resolve(e)

  const runs = (list: TextRun[]) =>
    list.map(run => (
      <Text
        color={run.color}
        bold={run.bold}
        dimColor={run.dim}
        italic={run.italic}
        underline={run.underline}
        strikethrough={run.strikethrough}
      >
        {run.text}
      </Text>
    ))

  const segmentWidth = (segment: Segment) =>
    segment.kind === 'image' ? segment.columns : visibleWidth(segment.runs.map(r => r.text).join(''))

  const picture = (segment: Extract<Segment, { kind: 'image' }>) => (
    <Image
      source={{ png: segment.image.png }}
      columns={segment.columns}
      rows={segment.rows}
      alt={formulaAlt(segment.image.tex, segment.image.display)}
    />
  )

  // A row of text and pictures; each text piece is held to its width so spaces around pictures stay.
  const line = (segments: Segment[]) => {
    if (segments.length === 0) return <Text> </Text>
    if (segments.every(s => s.kind === 'text'))
      return <Text>{segments.flatMap(s => (s.kind === 'text' ? runs(s.runs) : []))}</Text>
    return (
      <Box flexDirection="row">
        {segments.map(segment =>
          segment.kind === 'image' ? (
            picture(segment)
          ) : (
            <Box width={segmentWidth(segment)} flexShrink={0}>
              <Text wrap="clip">{runs(segment.runs)}</Text>
            </Box>
          ),
        )}
      </Box>
    )
  }

  const row = (r: Row) => {
    if (r.kind === 'line') return line(r.segments)
    const leftWidth = Math.max(0, ...r.left.map(segs => segs.reduce((w, s) => w + segmentWidth(s), 0)))
    return (
      <Box flexDirection="row">
        {leftWidth > 0 ? (
          <Box flexDirection="column" width={leftWidth} flexShrink={0}>
            {r.left.map(segs => line(segs))}
          </Box>
        ) : null}
        {picture(r.image)}
        <Box flexDirection="column">{r.right.map(segs => line(segs))}</Box>
      </Box>
    )
  }

  // Claude Code's own frame: a blank line above, the reply's bullet on its first block, two columns of indent.
  return (
    <Box flexDirection="row" marginTop={1}>
      <Box width={GUTTER} flexShrink={0}>
        <Text color="text">{e.props.isFirstOfReply ? '⏺' : ' '}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {parts.map((part, i) =>
          part.kind === 'markdown' ? (
            <Box marginTop={i > 0 ? 1 : 0}>
              <Markdown text={part.text} />
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={i > 0 ? 1 : 0}>
              {part.rows.map(row)}
            </Box>
          ),
        )}
      </Box>
    </Box>
  )
}
