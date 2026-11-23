import { expect, mock, test, type TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// The reply from the acceptance check: a Chinese table, inline formulas, a display formula, plus
// Markdown the plugin leaves to Claude Code (a paragraph, a code block).
const REPLY = [
  '下面是一个对比：',
  '',
  '| 方法 | 复杂度 | 说明 |',
  '| --- | --- | --- |',
  '| 快速排序 | $O(n \\log n)$ | 平均情况最快 |',
  '| 冒泡排序 | $O(n^2)$ | 简单但慢 |',
  '',
  '其中 $\\alpha + \\beta = \\gamma$，独立公式：',
  '',
  '$$',
  '\\int_0^1 x^2\\,dx = \\frac{1}{3}',
  '$$',
  '',
  '```python',
  'print("hi")',
  '```',
].join('\n')

const mountReply = ($: Engine, text: string, extra: object = {}) =>
  $.ui.mount({
    plugin: 'better-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm1',
    props: { text, isFirstOfReply: true, ...extra },
    viewport: { columns: 80, rows: 40 },
  })

const answerSettings = (on: On, theme: string) =>
  on('settings.read', () => ({ value: { theme } }))

/** All text the drawing shows, in order. */
async function shownText(ui: Awaited<ReturnType<typeof mountReply>>): Promise<string> {
  const texts = await ui.findAll({ type: 'Text' })
  return texts.map(t => t.text ?? '').join('\n')
}

test('Ghostty: formulas become images, the table is aligned, the rest stays Markdown', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  answerSettings(on, 'dark')
  const ui = await mountReply($, REPLY)

  const images = await ui.findAll({ type: 'Image' })
  // Two in the table, one inline in the paragraph, one display formula.
  expect(images.length).toBe(4)
  const rows = images.map(i => (i.props as { rows: number }).rows)
  expect(Math.max(...rows)).toBeGreaterThan(1)
  for (const image of images) {
    const props = image.props as { source: { png: string }; alt: string }
    expect(props.source.png.startsWith('iVBORw0KGgo')).toBe(true) // a PNG
    expect(props.alt.length).toBeGreaterThan(0)
  }

  // Markdown without math or tables is handed to Claude Code's own renderer, verbatim.
  const markdown = await ui.findAll({ type: 'Markdown' })
  const sources = markdown.map(m => (m.props as { text: string }).text)
  expect(sources).toEqual(['下面是一个对比：', '```python\nprint("hi")\n```'])

  // The table's rows are drawn as text with box-drawing borders; no TeX source is left over.
  const text = await shownText(ui)
  expect(text).toContain('快速排序')
  expect(text).toContain('│')
  expect(text).not.toContain('\\log')
  expect(text).not.toContain('$')
  await ui.unmount()
})

test('without kitty graphics, formulas are readable text and the table is still aligned', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'Apple_Terminal' })
  answerSettings(on, 'light')
  const ui = await mountReply($, REPLY)

  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  const text = await shownText(ui)
  expect(text).toContain('α + β = γ')
  expect(text).toContain('快速排序')
  expect(text).toContain('│')
  await ui.unmount()
})

test("the theme in Claude Code's config file decides the formula color", async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'ghostty', HOME: '/home/u' })
  on('settings.read', () => ({ value: {} }))
  const read: string[] = []
  on('fs.read', (_$, e) => {
    read.push(e.path)
    if (e.path === '/home/u/.claude.json') return { value: '{"numStartups": 3, "theme": "light-daltonized", "x": 1}' }
    throw new Error('ENOENT')
  })
  on('fs.read', { path: /glyphs/ }, () => {
    throw new Error('no glyph files in tests')
  })
  const ui = await mountReply($, 'Euler: $e^{i\\pi} + 1 = 0$')
  expect(read).toContain('/home/u/.claude.json')
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(1)
  await ui.unmount()
  // A light theme draws formulas black: /better-render says which color is in use.
  const status = await $.command.run({
    command: 'better-render',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(JSON.stringify(status)).toContain('#000000')
})

test('inside tmux, pictures are off', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'tmux', TMUX: '/tmp/tmux-1/default,1,0', TERM: 'xterm-ghostty' })
  answerSettings(on, 'dark')
  const ui = await mountReply($, 'Euler: $e^{i\\pi} + 1 = 0$')
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  await ui.unmount()
})

test('a reply without math or tables is drawn by Claude Code itself', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  answerSettings(on, 'dark')
  // The test's own render hook stands for the engine's component.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await mountReply($, 'Just **words**, a [link](https://example.com) and `code`. It costs $5.')
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(await ui.findAll({ type: 'Markdown' })).toHaveLength(0)
  await ui.unmount()
})

test('a summary block is left to Claude Code', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  answerSettings(on, 'dark')
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await mountReply($, 'Summary with $x^2$', { isSummary: true })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
