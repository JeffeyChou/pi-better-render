# pi-streaming-preview

Streaming-first rich rendering for [pi](https://pi.dev)'s TUI: Markdown, code blocks, tables and
LaTeX formulas as real images, while the answer is still streaming. It is built for Ghostty and kitty.

- **Display only.** It swaps the display component and never edits the message. The session file
  and the next LLM request keep the original Markdown/LaTeX. A `context` hook also strips any
  terminal image artifacts before every request, as a safety net.
- **No big runtime.** Formulas go through MathJax → SVG → resvg → PNG in process, at about 1 ms per
  formula. There is no browser, Pandoc or daemon. If MathJax cannot handle a formula, a local
  `latex`+`dvipng` or `tectonic` is used asynchronously when one is installed.
- **Kitty Unicode placeholders.** Formula images are transmitted once. After that they are ordinary
  text cells, so they wrap, scroll and diff like text. Inline formulas sit inside the line.

## What it renders

| Element | Rendering |
|---|---|
| Headings | H1 with a `━` rule, H2 with a `─` rule, H3 `▍ title`, H4–H6 by color. No `#` markers |
| Lists | `• ◦ ▪` by depth, original numbering, `☑`/`☐` tasks, hanging indent |
| Quotes | `▎` bar; GitHub callouts `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` |
| Code | Background block, language label, pi's syntax highlighting, `↪` wraps, optional line numbers, no fences |
| Tables | Rounded borders, bold header, `:-:` alignment, CJK widths; columns shrink, then fall back to cards |
| Math | `$…$`, `\(…\)` inline; `$$…$$`, `\[…\]`, `\begin{align}…` display. Unicode fallback elsewhere |

Streaming cost stays nearly flat as a message grows. Lexing is incremental: only the last two blocks
are lexed again, and earlier tokens are reused. Rendered blocks are cached by token identity. A
61k-character answer costs about 0.6 ms per delta (`npm run bench`).

Images are sent together with the frame that shows them. After a full clear, which pi does on
resize, they are sent again, so formulas survive window resizes.

## Install

```sh
npm install
pi install /Users/jiefengzhou/Documents/vscode/pi-streaming-preview   # or: pi -e ./src/index.ts
```

## Commands

`/richmd` takes one of these arguments:

- `status` shows the renderer state.
- `on` / `off` turns rich rendering on, or switches back to pi's built-in Markdown.
- `math:streaming`, `math:final` or `math:off` controls when formulas become images.
- `lines` toggles line numbers in code blocks.
- `clear-cache` drops cached renders and the images sent to the terminal.

Environment variables:

- `PI_RICHMD_DEBUG=1` logs context-sanitizer checks to `~/.pi/agent/richmd-debug.log`.
- `PI_RICHMD_TEX=off|latex|tectonic` picks the TeX fallback.
- `PI_RICHMD_PLACEHOLDERS=0|1` overrides terminal detection.

Images are unavailable inside tmux/screen or in terminals without Kitty Unicode placeholders.
There, formulas use pi's Unicode approximation and everything else still renders.

## Development

```sh
npm test                                              # unit tests
npm run preview -- test/fixtures/perceptron.md        # render a file in this terminal
npm run preview -- test/fixtures/perceptron.md --stream   # also time the streaming path
```

The Kitty diacritic table and the MathJax scaling approach are adapted from
[Fadouse/pi-math](https://github.com/Fadouse/pi-math) (MIT).
