# pi-better-render

Streaming-first rich rendering for [pi](https://pi.dev)'s TUI. Markdown, code blocks, tables and
LaTeX formulas are rendered as the answer streams in. Formulas are real images in terminals with the
Kitty graphics protocol. Ghostty, kitty and WezTerm are tested; Warp is detected but not tested yet.

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

From a local checkout: `npm install`, then `pi install ./path/to/pi-better-render` (or `pi -e ./src/index.ts`).

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
| A multiplexer that renders Kitty graphics, such as Herdr | Unicode placeholders, after the overrides below | Not tested |
| tmux, screen, terminals without Kitty graphics | Unicode approximation | – |

Ghostty, kitty and WezTerm were tested with light and dark colors, in fullscreen and regular mode.

pi detects the four terminals above. For another terminal with the Kitty graphics protocol, start pi
with `PI_IMAGE_PROTOCOL=kitty` (pi's own override), and add `PI_BETTER_RENDER_IMAGES=placeholder`
if the terminal also supports Unicode placeholders.

Some multiplexers, such as [Herdr](https://github.com/herdrdev/herdr), run their own terminal
emulator and draw Kitty graphics, Unicode placeholders included, on the outer terminal. pi does not
detect them, so start pi in the pane with both overrides:

```sh
PI_IMAGE_PROTOCOL=kitty PI_BETTER_RENDER_IMAGES=placeholder pi
```

Images then need an outer terminal with Kitty graphics and the multiplexer's image support turned on
(in Herdr, `terminal.kitty_graphics`, on by default). Otherwise formulas come out blank, so leave the
overrides unset and keep the Unicode approximation.

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

## How it works

The extension swaps pi's Markdown component for its own and never edits the message, so the session
file and the next LLM request keep the original Markdown and LaTeX. Each delta is lexed incrementally
with `marked`, and finished blocks come from a cache. Formulas are typeset in process by MathJax 4
(TeX → SVG), rasterized by resvg onto whole terminal cells, and sent once over the Kitty graphics
protocol, so they wrap and scroll like text.

## Performance

On an Apple M-series laptop, a formula takes about 1 ms from TeX to PNG (about 10 ms with CJK text),
and MathJax starts in about 105 ms in the background. A streaming frame takes about 0.6 ms on average
over a 61k-character answer. `npm run bench` reproduces the streaming numbers.

## Development

```sh
npm test                                                  # unit tests (rebuilds vendor/ first)
npm run typecheck
npm run bench                                             # streaming cost per delta
npm run preview -- test/fixtures/perceptron.md [--live]   # render a file in this terminal
```

`npm run build` bundles the MathJax parts in use into `vendor/` (about 12 MB, mostly on-demand font
data), so an install is about 15 MB instead of 118 MB. `vendor/` is committed because pi installs git
packages without a build step; MathJax is pinned exactly, so `vendor/` only changes with the pins.
`npm publish` runs the typecheck and tests first.

## Changelog

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

[MathJax](https://www.mathjax.org) (Apache-2.0) is bundled in `vendor/`; see `vendor/LICENSE`.

The Kitty diacritic table and the formula-scaling approach are adapted from
[Fadouse/pi-math](https://github.com/Fadouse/pi-math) (MIT).

## License

MIT
