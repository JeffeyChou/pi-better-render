# pi-better-render

Streaming-first rich rendering for [pi](https://pi.dev)'s TUI. Markdown, code blocks, tables and
LaTeX formulas are rendered as the answer streams in, with formulas shown as real images. It is
built for Ghostty and kitty.

![Streaming Markdown, tables, code and formulas in Ghostty](assets/demo.gif)

- **Display only.** It replaces the component that displays a message and never edits the message.
  The session file and the next LLM request keep the original Markdown/LaTeX. As a safety net, a
  `context` hook also strips any terminal image artifacts before every request.
- **Formulas while streaming.** Each formula becomes an image as soon as it is complete. There is no
  waiting for the message to end.
- **In process, no big runtime.** No browser, Pandoc or daemon is involved. A formula takes about
  1 ms from TeX to PNG.
- **Text-like images.** Formula images use Kitty Unicode placeholders. Each image is sent once;
  after that it behaves as ordinary text cells, so it wraps, scrolls and diffs like text. Inline
  formulas sit inside the line.

## Compared with other pi extensions

| | **pi-better-render** | [pi-math](https://github.com/Fadouse/pi-math) | [pi-markdown-preview](https://github.com/omaclaren/pi-markdown-preview) | [pi-rich-renderer](https://github.com/dbydd/pi-rich-renderer) |
|---|---|---|---|---|
| Where it shows | In the chat, automatically | In the chat, automatically | Separate viewer (`/preview`), browser or PDF | In the chat, automatically |
| Updates while streaming | ✅ Markdown and formulas, on every delta | ✅ Formulas | ❌ On demand; watch mode refreshes after each completed reply | ❌ Only when the message ends |
| Restyles Markdown (headings, callouts, tables, code) | ✅ | ❌ pi's built-in | ✅ As a Pandoc HTML page | ❌ pi's built-in |
| Formulas inside the text line | ✅ | ✅ | ✅ Inside a page screenshot | ❌ Each formula becomes a block image |
| Math engine | MathJax 4, with optional TeX fallback | MathJax 3 | Pandoc MathML + MathJax in Chromium | `latex` + `dvipng` per formula |
| Needs beyond `npm install` | Nothing (TeX is optional) | Nothing | Pandoc and Chromium; LaTeX for PDF | A TeX installation |
| Stored message and LLM context | Untouched (display only) | Untouched (display only) | Untouched (read only) | Message content replaced at `message_end`; original restored for the LLM |
| Terminals with images | Ghostty, kitty | Ghostty, kitty; display formulas also in WezTerm, Warp, iTerm2 | Ghostty, kitty, iTerm2, WezTerm | Those supported by pi's image component |
| Without images | Unicode approximation | Original LaTeX | – | Original LaTeX |
| Beyond chat rendering | Mermaid diagrams as Unicode art | Custom macros and environments | Browser and PDF export, Mermaid, file preview, export tool | Disk cache of PNGs |

Each existing extension covers one part of the problem:

- **pi-math** typesets formulas in the chat but leaves the rest of the Markdown to pi.
- **pi-markdown-preview** renders a complete, polished page, but in a separate viewer after the
  reply has finished.
- **pi-rich-renderer** needs a TeX installation and swaps in images only once the message ends.

pi-better-render fills the gap between them. It renders the whole answer, Markdown structure and
math alike, in the chat while it streams, in process, with nothing extra to install.

The others are still the better choice in some cases. For PDF or browser output, or for Mermaid
diagram types beyond flowchart, sequence, state, class and ER, use pi-markdown-preview. For formula images in iTerm2, WezTerm or Warp, use pi-math.
(Comparison as of September 2026.)

## What it renders

| Element | Rendering |
|---|---|
| Headings | H1 with a `━` rule, H2 with a `─` rule, H3 as `▍ title`, H4–H6 by color. No `#` markers |
| Emphasis | **bold**, *italic*, ~~strikethrough~~, `inline code`, clickable links (OSC 8) with the URL shown |
| Lists | `• ◦ ▪` by depth, original numbering, `☑`/`☐` tasks, hanging indent |
| Quotes | `▎` bar. GitHub callouts `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` |
| Code | Background block, language label, pi's syntax highlighting, `↪` wraps, optional line numbers, no fences |
| Tables | Rounded borders, bold header, `:-:` alignment, correct CJK widths. Columns shrink, then fall back to cards |
| Mermaid | ` ```mermaid ` flowchart, sequence, state, class and ER diagrams drawn with box characters (correct CJK widths). The renderer is downloaded on the first diagram (see below). Other types, invalid source or diagrams wider than the terminal stay as code |
| Rules | Full-width `─` |
| Math | See below |

### Math

- **Delimiters:** inline `$…$` and `\(…\)`; display `$$…$$`, `\[…\]` and `\begin{align}…` (plus the
  other AMS environments).
- **TeX packages:** AMS, mathtools, physics (`\dv`, `\pdv`, `\qty`, `\abs`, `\norm`), mhchem
  (`\ce`), braket, cancel, cases, empheq, bbm/dsfont/bboldx (`\mathbbm`, `\mathds`), color,
  boldsymbol, upgreek, gensymb, units, extpfeil, centernot, bussproofs, amscd.
- **Extra macros:** `\bm`, `\llbracket`/`\rrbracket`, and a single `\tag{…}`.
- **CJK text:** text inside formulas, such as `\text{中文}` or `\text{한국어}`, is rendered with a
  system CJK font. Without one (common on Linux servers and containers), Noto Sans SC (10 MB, Han
  and kana) or KR (6 MB, Hangul) is downloaded once into `~/.pi/agent/better-render/fonts`, checked
  against a pinned SHA-256. The formula shows as text until the font arrives, then as an image.
- **Fallback:** if MathJax rejects a formula and a local `latex`+`dvipng` or `tectonic` is
  installed, that engine typesets it in the background. Where images are not possible, formulas
  use pi's Unicode approximation.

## Performance

Measured on an Apple M-series laptop.

| | |
|---|---|
| MathJax 4 + resvg startup (background, after session start) | ~105 ms |
| Formula, TeX → SVG | ~0.3 ms |
| Formula, TeX → SVG → PNG on the cell grid | ~1 ms |
| Formula with CJK text | ~10 ms |
| Streaming delta at the end of a 61k-character answer | ~0.6 ms per frame |
| Streaming delta, 3.8k-character answer | ~0.04 ms per frame |

Streaming cost stays nearly flat as a message grows, for these reasons:

- **Incremental lexing.** Only the last two blocks are lexed again; earlier tokens are reused.
- **Block cache.** Rendered blocks are cached by token identity, so finished blocks are never
  rendered again.
- **Formula cache.** Formula rasters are cached by TeX, color and cell size, and each image is sent
  to the terminal only once.
- **Images travel with their frame.** An image is sent together with the frame that first shows
  it. pi does a full clear on resize; after one, images are sent again, so formulas survive window
  resizes.

Run `npm run bench` to reproduce the streaming numbers.

## How it works

```
assistant delta ─▶ incremental lexer (marked) ─▶ block renderer + cache ─▶ ANSI lines ─▶ pi-tui
                                                   │
                                                   └─ formula ─▶ MathJax 4 (TeX → SVG)
                                                                  ─▶ resvg (SVG → PNG, cell-exact)
                                                                  ─▶ Kitty graphics, virtual placement
                                                                  ─▶ U+10EEEE placeholder cells in the line
```

| Part | Technology |
|---|---|
| Host | pi extension API. It patches the assistant message component and registers a `context` hook |
| Markdown | `marked` lexer (via pi-tui), with its own incremental re-lexing and block renderers |
| Code highlighting | pi's theme highlighter |
| Math typesetting | [MathJax 4](https://www.mathjax.org/) (`@mathjax/src`, New Computer Modern font), in process and synchronous |
| Rasterizing | [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js) (Rust, native). Canvases are sized to whole terminal cells, so images are never stretched |
| Terminal images | Kitty graphics protocol with Unicode placeholders (Ghostty, kitty) |
| Fallback | Optional `latex`+`dvipng` or `tectonic` in a sandboxed child process. No shell escape, paranoid file access, 15 s timeout |

## Install

```sh
pi install npm:pi-better-render                       # from npm
pi install git:github.com/JeffeyChou/pi-better-render
pi -e npm:pi-better-render                            # try it for one run without installing
```

From a local checkout:

```sh
npm install
pi install ./path/to/pi-better-render                 # or: pi -e ./src/index.ts
```

Images need Ghostty or kitty. They are unavailable inside tmux/screen and in terminals without Kitty
Unicode placeholders. There, formulas use pi's Unicode approximation and everything else still
renders.

## Commands

`/better-render` takes one of these arguments:

- `status` shows the renderer state, the math engine, cache hit rates and formula timings.
- `on` / `off` turns rich rendering on, or switches back to pi's built-in Markdown.
- `math:streaming`, `math:final` or `math:off` controls when formulas become images.
- `lines` toggles line numbers in code blocks.
- `mermaid` toggles drawing ` ```mermaid ` blocks as diagrams (off shows their source).
  The diagram renderer ([beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid), about
  11 MB with its layout engine) is not installed with the package. The first ` ```mermaid ` block
  installs the pinned version with npm into `~/.pi/agent/better-render/deps` in the background; the
  block shows as code until then and turns into a diagram when it arrives.
- `clear-cache` drops cached renders and the images sent to the terminal.

Environment variables:

- `PI_BETTER_RENDER_DEBUG=1` logs context-sanitizer checks to `~/.pi/agent/better-render-debug.log`.
- `PI_BETTER_RENDER_TEX=off|latex|tectonic` picks the TeX fallback.
- `PI_BETTER_RENDER_MERMAID_INSTALL=0` never downloads the Mermaid renderer (diagrams stay as code
  unless `beautiful-mermaid` is already installed).
- `PI_BETTER_RENDER_DEPS_DIR` changes where it is downloaded (default `~/.pi/agent/better-render/deps`).
- `PI_BETTER_RENDER_FONT_DOWNLOAD=0` never downloads a CJK font; `PI_BETTER_RENDER_FONTS_DIR`
  changes where it goes.
- `PI_BETTER_RENDER_PLACEHOLDERS=0|1` overrides terminal detection. 

## Development

```sh
npm test                                                  # unit tests (rebuilds vendor/ first)
npm run build                                             # rebuild vendor/ (the trimmed MathJax)
npm run typecheck
npm run bench                                             # streaming cost per delta
npm run preview -- test/fixtures/perceptron.md            # render a file in this terminal
npm run preview -- test/fixtures/perceptron.md --stream   # also time the streaming path
npm run preview -- test/fixtures/perceptron.md --live     # animate the stream on screen
```

MathJax is a development dependency. `npm run build` bundles the parts the renderer uses into
`vendor/` (about 12 MB, most of it on-demand font data), so an install is about 15 MB instead of
118 MB. `vendor/` is committed because pi installs git packages with `npm install --omit=dev` and
no build step. MathJax is pinned to exact versions and the build is deterministic, so `vendor/`
only changes when those pins change (the build refuses ranges or a drifted `node_modules`);
`vendor/README.md` lists what it contains. Without `vendor/`, the code loads MathJax from
`node_modules` directly.

Publishing:

```sh
npm pack --dry-run   # the tarball holds src/, vendor/, README.md, LICENSE and package.json
npm publish          # runs typecheck and tests first (prepublishOnly)
```

The `pi-package` keyword lists the package in the [pi package gallery](https://pi.dev/packages).

## Credits

[MathJax](https://www.mathjax.org) (Apache-2.0) is bundled in `vendor/`; see `vendor/LICENSE`.

The Kitty diacritic table and the formula-scaling approach are adapted from
[Fadouse/pi-math](https://github.com/Fadouse/pi-math) (MIT).

## License

MIT
