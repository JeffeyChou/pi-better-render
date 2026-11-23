# pi-better-render

Streaming-first rich rendering for [pi](https://pi.dev)'s TUI. Markdown, code blocks, tables and
LaTeX formulas are rendered as the answer streams in. Formulas are real images in terminals with the
Kitty graphics protocol. Ghostty, kitty and WezTerm are tested; Warp is detected but not tested yet.

The same renderer also runs in [Claude Code](#claude-code), as a plugin: formulas as images and
aligned CJK tables in its replies, in the `claude` you already start.

![Streaming Markdown, tables, code and formulas in Ghostty](assets/demo.gif)

- **Display only.** It replaces the component that displays a message and never edits the message.
  The session file and the next LLM request keep the original Markdown/LaTeX. As a safety net, a
  `context` hook also strips any terminal image artifacts before every request.
- **Formulas while streaming.** Each formula becomes an image as soon as it is complete. There is no
  waiting for the message to end.
- **In process, no big runtime.** No browser, Pandoc or daemon is involved. A formula takes about
  1 ms from TeX to PNG.
- **Text-like images.** Inline formulas sit inside the line, and every formula wraps, scrolls and
  diffs like text. Each image is sent to the terminal once and drawn in the theme's text color, on
  light and dark backgrounds. Formulas stay in the scrollback after pi exits.
- **Copy as Markdown.** Selecting an answer copies each formula as its LaTeX source, so pasted text
  is working Markdown again.

## Compared with other pi extensions

| | **pi-better-render** | [pi-math](https://github.com/Fadouse/pi-math) | [pi-markdown-preview](https://github.com/omaclaren/pi-markdown-preview) | [pi-rich-renderer](https://github.com/dbydd/pi-rich-renderer) |
|---|---|---|---|---|
| Where it shows | In the chat, automatically | In the chat, automatically | Separate viewer (`/preview`), browser or PDF | In the chat, automatically |
| Updates while streaming | ✅ Markdown and formulas, on every delta | ✅ Formulas | ❌ On demand; the browser's live mode updates per recorded message, not per token | ❌ Only when the message ends |
| Restyles Markdown (headings, callouts, tables, code) | ✅ | ❌ pi's built-in | ✅ As a Pandoc HTML page | ❌ pi's built-in |
| Formulas inside the text line | ✅ | ✅ | ✅ Inside a page screenshot | ❌ Each formula becomes a block image |
| Copying formulas from the chat | ✅ As their LaTeX source (fullscreen mode) | ❌ Not handled | – Separate viewer | ❌ Not handled |
| Math engine | MathJax 4, with optional TeX fallback | MathJax 3 | Pandoc MathML + MathJax in Chromium | `latex` + `dvipng` per formula |
| Needs beyond `npm install` | Nothing (TeX is optional) | Nothing | Pandoc and Chromium; LaTeX for PDF | A TeX installation |
| Stored message and LLM context | Untouched (display only) | Untouched (display only) | Untouched (read only) | Message content replaced at `message_end`; original restored for the LLM |
| Terminals with images | Kitty graphics terminals: Ghostty, kitty, WezTerm, Warp, others by override | Ghostty, kitty; WezTerm, Warp; iTerm2 (display formulas only) | Ghostty, kitty, iTerm2, WezTerm | Those supported by pi's image component |
| Without images | Unicode approximation | Original LaTeX | – | Original LaTeX |
| Beyond chat rendering | Mermaid diagrams as Unicode art | Custom macros and environments | Browser and PDF export, live view of tool calls, Mermaid, file preview, export tool | Disk cache of PNGs |

Each existing extension covers one part of the problem:

- **pi-math** typesets formulas in the chat but leaves the rest of the Markdown to pi.
- **pi-markdown-preview** renders a complete, polished page, but in a separate viewer after the
  reply has finished.
- **pi-rich-renderer** needs a TeX installation and swaps in images only once the message ends.

pi-better-render fills the gap between them. It renders the whole answer, Markdown structure and
math alike, in the chat while it streams, in process, with nothing extra to install.

The others are still the better choice in some cases. For PDF or browser output, or for Mermaid
diagram types beyond flowchart, sequence, state, class and ER, use pi-markdown-preview. For formula images in iTerm2, use pi-math.
(Comparison as of October 2026.)

## Install

```sh
pi install npm:pi-better-render                       # from npm
pi install git:github.com/JeffeyChou/pi-better-render
pi -e npm:pi-better-render                            # try it for one run without installing
```

From a local checkout: `npm install`, then `pi install ./path/to/pi-better-render` (or `pi -e ./src/pi/index.ts`).

For Claude Code, see [Claude Code](#claude-code). The optional
[`better-render`](packages/better-render) command installs into either host with that host's own
installer and reports what is set up:

```sh
npx better-render install --target pi        # or --target claude
npx better-render doctor
```

## What it renders

- **Markdown:** headings without `#` markers, emphasis, clickable links (OSC 8), lists and task lists,
  quotes and GitHub callouts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]` …), rules.
- **Code:** a background block with the language label and pi's syntax highlighting, no fences.
- **Tables:** rounded borders, column alignment and correct CJK widths. Narrow terminals shrink the
  columns, then show cards.
- **Math:** `$…$`, `\(…\)`, `$$…$$`, `\[…\]` and the AMS environments, typeset by MathJax 4 with AMS,
  mathtools, physics, mhchem, braket, cancel, bbm and more. Formulas take the theme's text color, in
  light and dark terminals. `\text{中文}` uses a system CJK font, or downloads Noto Sans SC/KR once
  (checked against a pinned SHA-256). Formulas MathJax rejects go to a local `latex`+`dvipng` or
  `tectonic` when one is installed. Without terminal images, formulas use pi's Unicode approximation.
- **Mermaid:** flowchart, sequence, state, class and ER diagrams as box drawings. The renderer
  (about 11 MB) is downloaded into `~/.pi/agent/better-render/deps` on the first diagram; until then,
  and for other diagram types, the block stays as code.

## Copying

In pi's fullscreen mode (the default), selecting text copies formulas as their Markdown source,
for example `$C_\ell^*$` or a `$$ … $$` block, so pasted answers keep working math. Code blocks have a
**Copy** button that copies the source without fences or line numbers.

In regular mode (`--tui-mode regular`) the terminal does the copying, and formulas come out as the
image placeholder characters.

## Terminals

Formula images work in terminals with the Kitty graphics protocol. Everything else renders in any
terminal, and formulas fall back to a Unicode approximation where images are not available.

| Terminal | How formulas are drawn | Tested with pi 1.4.0 on macOS |
|---|---|---|
| Ghostty | Unicode placeholders | 1.3.1 |
| kitty | Unicode placeholders | 0.49.2 |
| WezTerm | One direct placement per formula row | 20240203 and nightly 20261026 |
| Warp | One direct placement per formula row | Not tested |
| Another terminal with Kitty graphics | Direct placements, after the override below | – |
| tmux, screen, terminals without Kitty graphics | Unicode approximation | – |

Ghostty, kitty and WezTerm were tested with light and dark colors, in fullscreen and regular mode.

pi detects the four terminals above. For another terminal with the Kitty graphics protocol, start pi
with `PI_IMAGE_PROTOCOL=kitty` (pi's own override), and add `PI_BETTER_RENDER_IMAGES=placeholder`
if the terminal also supports Unicode placeholders.

## Commands

`/better-render <argument>`:

| Argument | Effect |
|---|---|
| `status` | Renderer state, math engine, cache hit rates and formula timings |
| `on` / `off` | Rich rendering, or pi's built-in Markdown |
| `math:streaming` / `math:final` / `math:off` | Formulas become images while streaming, after the message ends, or never |
| `lines` | Toggle line numbers in code blocks |
| `mermaid` | Toggle Mermaid diagrams (off shows their source) |
| `clear-cache` | Drop cached renders and free terminal images (formulas in the scrollback go blank) |

Environment variables:

| Variable | Effect |
|---|---|
| `PI_BETTER_RENDER_IMAGES=placeholder\|direct\|off` | Override terminal detection |
| `PI_BETTER_RENDER_TEX=off\|latex\|tectonic` | Pick the TeX fallback |
| `PI_BETTER_RENDER_MERMAID_INSTALL=0` | Never download the Mermaid renderer |
| `PI_BETTER_RENDER_FONT_DOWNLOAD=0` | Never download a CJK font |
| `PI_BETTER_RENDER_DEPS_DIR`, `PI_BETTER_RENDER_FONTS_DIR` | Where downloads go |
| `PI_BETTER_RENDER_DEBUG=1` | Log context-sanitizer checks to `~/.pi/agent/better-render-debug.log` |

## Claude Code

The `better-render` plugin draws Claude Code replies that contain formulas or tables with the same
renderer. Install it from this repository's marketplace, at the Claude Code prompt:

```
/plugin install better-render --marketplace JeffeyChou/pi-better-render
```

or from a shell: `claude plugin marketplace add JeffeyChou/pi-better-render`, then
`claude plugin install better-render@pi-better-render` (or `npx better-render install --target claude`).
Claude Code 2.1.330 or later; start a new session, or run `/reload-plugins`, after installing.

- **Display only.** The plugin answers Claude Code's `AssistantMessage` render hook, which changes
  the drawing alone: the stored reply, the transcript and the model's context keep the original
  Markdown.
- **Only where it helps.** Text blocks with math or tables are drawn by the shared renderer; the
  other blocks of the reply, and replies without math or tables, stay with Claude Code's own
  Markdown (code highlighting, links).
- **After each text block.** Claude Code hands the plugin finished text blocks, so formulas appear
  when a block is complete rather than while it streams.
- **Formula images in Ghostty and kitty**, through Claude Code's own image support. Elsewhere, and
  inside tmux, formulas are a readable Unicode approximation and tables stay aligned. Formulas with
  CJK in `\text{…}` also stay text, since the plugin has no text fonts.

`/better-render` shows how the plugin draws in the current terminal. Options, in `/plugin` →
better-render → configure: `images` (`auto`, `on`, `off`), `cellAspect` (your font's cell height
divided by its width, 2.1 by default) and `formulaColor` (white or black by Claude's theme unless set).

## How it works

The extension swaps pi's Markdown component for its own and never edits the message, so the session
file and the next LLM request keep the original Markdown and LaTeX. Each delta is lexed incrementally
with `marked`, and finished blocks come from a cache. Formulas are typeset in process by MathJax 4
(TeX → SVG), rasterized by resvg onto whole terminal cells, and sent once over the Kitty graphics
protocol, so they wrap and scroll like text.

The rendering is shared between hosts; each host has a thin adapter that receives replies and draws:

| Path | What it is | Ships in |
|---|---|---|
| `src/core` | Markdown lexer, block, inline and CJK table layout, MathJax (TeX → SVG → PNG with the host's rasterizer), render caches. No Node, no host API. | both |
| `src/pi` | pi extension: the Markdown component patch, Kitty placeholders, formula copying, fonts, TeX fallback, Mermaid, resvg-js | the npm package |
| `src/claude` + `plugins/claude` | Claude Code plugin: the render hook, theme-key styles, formula pictures as `Image` elements; MathJax and resvg-wasm bundled into `plugins/claude/lib` | the marketplace |
| `packages/better-render` | the optional installer and `doctor` | its own npm package |

## Performance

On an Apple M-series laptop, a formula takes about 1 ms from TeX to PNG (about 10 ms with CJK text),
and MathJax starts in about 105 ms in the background. A streaming frame takes about 0.6 ms on average
over a 61k-character answer. `npm run bench` reproduces the streaming numbers.

## Development

```sh
npm test                                                  # unit tests (rebuilds vendor/ and plugins/claude/lib first)
npm run typecheck
npm run test:claude                                       # the Claude Code plugin in Claude Code's sandbox (needs `claude`)
npm run test:installer
npm run check:pack                                        # what each npm package would publish
node tools/verify-pi-tarball.mjs                          # the pi tarball, installed clean, renders
node tools/verify-claude-install.mjs                      # the plugin, installed from the marketplace into an empty config
npm run bench                                             # streaming cost per delta
npm run preview -- test/fixtures/perceptron.md [--live]   # render a file in this terminal
```

`npm run build` bundles the MathJax parts in use into `vendor/` (about 12 MB, mostly on-demand font
data), so an install is about 15 MB instead of 118 MB, and builds `plugins/claude/lib/` for Claude
Code: ES module chunks under its 1 MiB-per-file and 8 MiB limits, `resvg.wasm`, and MathJax's glyph
data as JSON. Both are committed because pi installs git packages and Claude Code installs plugins
without a build step; the inputs are pinned exactly, so the output only changes with the pins or the
sources, and CI checks that it matches. `npm publish` runs the typecheck and tests first.

## Changelog

### Unreleased

- Claude Code plugin (`plugins/claude`), installed from this repository's marketplace: formulas as
  images in Ghostty and kitty and aligned CJK tables in Claude Code replies, display only.
- The renderer is split into a host-neutral core (`src/core`) and the pi adapter (`src/pi`). pi's
  rendering is unchanged; the extension entry moved to `src/pi/index.ts`.
- `better-render install --target pi|claude` and `better-render doctor`
  ([`packages/better-render`](packages/better-render)).

### 0.5.0 (2026-10-31)

All in [#6](https://github.com/JeffeyChou/pi-better-render/pull/6).

- Formulas were nearly invisible in light terminals with pi's default `system` theme
  ([#5](https://github.com/JeffeyChou/pi-better-render/issues/5)). They now take the theme's text
  color, and messages already on screen follow theme switches.
- Selecting text in fullscreen mode copies formulas as their Markdown source instead of placeholder
  characters.
- Tested in Ghostty, kitty and WezTerm, with a terminal support table in this README.
- WezTerm showed only the last row of a display formula, and only the last copy of a formula used
  twice. Every row and every copy now shows.
- A terminal started from a Ghostty or kitty shell (`open -a WezTerm`) was taken for Ghostty or kitty
  and got garbled formulas.

### 0.4.0 (2026-10-18)

- Copy buttons on code blocks in fullscreen mode
  ([#2](https://github.com/JeffeyChou/pi-better-render/pull/2), by @xiaotianxt).
- Font download tests wait for the download instead of a fixed delay (#3, #4).

### 0.3.0 (2026-10-12)

- Formulas stay in the scrollback after pi exits, and after `/new`, `/resume` or `/reload`
  ([#1](https://github.com/JeffeyChou/pi-better-render/pull/1)).
- Formulas survive pi's fullscreen redraws, which delete image placements.
- Formula images in WezTerm and Warp, through direct placements. `PI_BETTER_RENDER_IMAGES` overrides
  the detection.

### 0.2.0 (2026-09-24)

- Mermaid diagrams as box drawings, with the renderer downloaded on first use, and
  `/better-render mermaid`.
- CJK text in formulas, with Noto Sans SC/KR downloaded when no system font covers it.
- MathJax is bundled into `vendor/`, so an install shrinks from 118 MB to about 15 MB.

### 0.1.0 (2026-09-24)

- First release: streaming Markdown, code, tables and MathJax 4 formula images in pi's TUI, display
  only, with incremental lexing.

## Credits

[MathJax](https://www.mathjax.org) (Apache-2.0) is bundled in `vendor/`; see `vendor/LICENSE`. The
Claude Code plugin also bundles [resvg-wasm](https://github.com/thx/resvg-js) (MPL-2.0); see
`plugins/claude/lib/LICENSES.md`.

The Kitty diacritic table and the formula-scaling approach are adapted from
[Fadouse/pi-math](https://github.com/Fadouse/pi-math) (MIT).

## License

MIT
