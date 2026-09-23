import { sliceByColumn } from "@earendil-works/pi-tui";
import { state } from "../state.ts";
import type { RenderContext } from "./context.ts";
import { pad, visibleWidth } from "./util.ts";

const BG_RESET = "\x1b[49m";

/** Keep the block background alive across resets emitted by the highlighter. */
function withBackground(line: string, bg: string): string {
	if (!bg) return line;
	return line.replace(/\x1b\[0?m/g, (m) => m + bg).replace(/\x1b\[49m/g, bg);
}

function hardWrap(line: string, width: number): string[] {
	const total = visibleWidth(line);
	if (total <= width) return [line];
	const out: string[] = [];
	for (let col = 0; col < total; col += width) out.push(sliceByColumn(line, col, width, true));
	return out;
}

/**
 * Code block: full-width background, language label in the top-right corner,
 * optional line numbers, hard-wrapped long lines marked with ↪. No ``` fences.
 */
export function renderCode(token: any, ctx: RenderContext): string[] {
	const { style } = ctx;
	const lang: string = (token.lang ?? "").trim().split(/\s+/)[0] ?? "";
	const source: string = (token.text ?? "").replace(/\t/g, "    ");
	const highlighted = style.highlight(source, lang || undefined) ?? source.split("\n").map((l) => style.fg("mdCodeBlock", l));

	const width = Math.max(8, ctx.width);
	const numberWidth = state.lineNumbers ? String(highlighted.length).length + 1 : 0;
	const gutterWidth = numberWidth > 0 ? numberWidth + 1 : 1;
	const inner = Math.max(4, width - gutterWidth - 1);
	const bg = style.codeBg;
	const row = (gutter: string, content: string) =>
		bg ? bg + withBackground(gutter + pad(content, inner) + " ", bg) + BG_RESET : (gutter + content).replace(/\s+$/, "");

	const lines: string[] = [];
	const label = lang ? style.fg("muted", lang) : "";
	lines.push(row(" ".repeat(gutterWidth), pad(label, inner, "right")));
	highlighted.forEach((line, index) => {
		const pieces = hardWrap(line, inner);
		pieces.forEach((piece, i) => {
			let gutter: string;
			if (numberWidth > 0) {
				const n = i === 0 ? String(index + 1).padStart(numberWidth - 1) : "↪".padStart(numberWidth - 1);
				gutter = style.fg("dim", n) + "  ";
			} else {
				gutter = i === 0 ? " " : style.fg("dim", "↪");
			}
			lines.push(row(gutter, piece));
		});
	});
	lines.push(row(" ".repeat(gutterWidth), ""));
	return lines;
}
