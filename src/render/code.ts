import { sliceByColumn } from "@earendil-works/pi-tui";
import { state } from "../state.ts";
import type { RenderContext } from "./context.ts";
import { isMermaid, mermaidPendingNote, renderMermaid } from "./mermaid.ts";
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

/** The block ends with its closing fence (a streaming block may still be open). */
export function fenceClosed(raw: string): boolean {
	const marker = /^ {0,3}(`{3,}|~{3,})/.exec(raw)?.[1];
	if (!marker) return true; // indented code
	const lines = raw.replace(/\n+$/, "").split("\n");
	if (lines.length < 2) return false;
	const last = lines[lines.length - 1]!.trim();
	return last.length >= marker.length && last === marker[0]!.repeat(last.length);
}

/**
 * Code block: full-width background, language label in the top-right corner,
 * optional line numbers, hard-wrapped long lines marked with ↪. No ``` fences.
 */
export function renderCode(token: any, ctx: RenderContext): string[] {
	const { style } = ctx;
	const lang: string = (token.lang ?? "").trim().split(/\s+/)[0] ?? "";
	const source: string = (token.text ?? "").replace(/\t/g, "    ");
	if (isMermaid(lang) && (!ctx.streaming || fenceClosed(token.raw ?? ""))) {
		const diagram = renderMermaid(source, ctx);
		if (diagram) return diagram;
	}
	const highlighted = style.highlight(source, lang || undefined) ?? source.split("\n").map((l) => style.fg("mdCodeBlock", l));

	const width = Math.max(8, ctx.width);
	const numberWidth = state.lineNumbers ? String(highlighted.length).length + 1 : 0;
	const gutterWidth = numberWidth > 0 ? numberWidth + 1 : 1;
	const inner = Math.max(4, width - gutterWidth - 1);
	const bg = style.codeBg;
	const row = (gutter: string, content: string) =>
		bg ? bg + withBackground(gutter + pad(content, inner) + " ", bg) + BG_RESET : (gutter + content).replace(/\s+$/, "");

	const lines: string[] = [];
	const note = isMermaid(lang) ? mermaidPendingNote() : "";
	const label = lang ? style.fg("muted", note ? `${lang} · ${note}` : lang) : "";
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
