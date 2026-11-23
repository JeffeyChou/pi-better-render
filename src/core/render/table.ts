import type { RenderContext } from "./context.ts";
import { renderInline } from "./inline.ts";
import { type Align, pad, visibleWidth, wrap } from "./util.ts";

const MIN_COLUMN = 3;

/**
 * Distribute `available` columns: every column gets what it needs if possible;
 * otherwise wide columns are shrunk (water-filling) down to their longest word.
 */
export function fitColumns(natural: number[], minimum: number[], available: number): number[] | undefined {
	const n = natural.length;
	if (available < n * MIN_COLUMN) return undefined;
	const total = natural.reduce((a, b) => a + b, 0);
	if (total <= available) return natural.slice();

	const floor = minimum.map((m, i) => Math.min(natural[i]!, Math.max(MIN_COLUMN, m)));
	const floorTotal = floor.reduce((a, b) => a + b, 0);
	if (floorTotal > available) {
		// Even the longest words do not fit: share proportionally, words will be broken.
		const widths = natural.map((w) => Math.max(MIN_COLUMN, Math.floor((w / total) * available)));
		let extra = available - widths.reduce((a, b) => a + b, 0);
		for (let i = 0; extra > 0 && i < n; i++, extra--) widths[i]!++;
		return widths.every((w) => w >= MIN_COLUMN) && widths.reduce((a, b) => a + b, 0) <= available ? widths : undefined;
	}

	// Water-fill: find a cap so that sum(max(floor, min(natural, cap))) <= available.
	let lo = 0;
	let hi = Math.max(...natural);
	const used = (cap: number) => natural.reduce((sum, w, i) => sum + Math.max(floor[i]!, Math.min(w, cap)), 0);
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (used(mid) <= available) lo = mid;
		else hi = mid - 1;
	}
	const widths = natural.map((w, i) => Math.max(floor[i]!, Math.min(w, lo)));
	let extra = available - widths.reduce((a, b) => a + b, 0);
	for (let i = 0; extra > 0 && i < n; i++) {
		if (widths[i]! < natural[i]!) {
			const add = Math.min(extra, natural[i]! - widths[i]!);
			widths[i]! += add;
			extra -= add;
		}
	}
	return widths;
}

function longestWord(text: string): number {
	let longest = 0;
	for (const word of text.split(/\s+/)) longest = Math.max(longest, visibleWidth(word));
	return longest;
}

/**
 * Table with rounded borders, bold header, column alignment and CJK-aware
 * widths. Too narrow for a grid → one "card" per row.
 */
export function renderTable(token: any, ctx: RenderContext): string[] {
	const { style } = ctx;
	const cellCtx: RenderContext = { ...ctx, width: Math.max(1, ctx.width) };
	const header: string[] = token.header.map((cell: any) => renderInline(cell.tokens, cellCtx));
	const rows: string[][] = token.rows.map((row: any[]) => row.map((cell: any) => renderInline(cell.tokens, cellCtx)));
	const aligns: Align[] = token.align.map((a: string | null) => (a === "center" || a === "right" ? a : "left"));
	const n = header.length;

	const natural = new Array(n).fill(0);
	const minimum = new Array(n).fill(0);
	for (const row of [header, ...rows]) {
		row.forEach((cell, i) => {
			for (const line of cell.split("\n")) natural[i] = Math.max(natural[i], visibleWidth(line));
			minimum[i] = Math.max(minimum[i], Math.min(longestWord(cell), 24));
		});
	}

	const available = ctx.width - (3 * n + 1);
	const widths = fitColumns(natural, minimum, available);
	if (!widths) return renderCards(header, rows, ctx);

	const border = (s: string) => style.fg("mdCodeBlockBorder", s);
	const rule = (l: string, m: string, r: string) => border(l + widths.map((w) => "─".repeat(w + 2)).join(m) + r);
	const renderRow = (cells: string[], isHeader: boolean): string[] => {
		const wrapped = widths.map((w, i) => wrap(cells[i] ?? "", w));
		const height = Math.max(...wrapped.map((c) => c.length));
		const out: string[] = [];
		for (let line = 0; line < height; line++) {
			let s = border("│");
			widths.forEach((w, i) => {
				const content = pad(wrapped[i]![line] ?? "", w, isHeader ? "left" : aligns[i]);
				const cell = ` ${isHeader ? style.bold(style.fg("mdHeading", content)) : content} `;
				s += (isHeader && style.headerBg ? style.headerBg + cell + "\x1b[49m" : cell) + border("│");
			});
			out.push(s);
		}
		return out;
	};

	const lines = [rule("╭", "┬", "╮"), ...renderRow(header, true), rule("├", "┼", "┤")];
	for (const row of rows) lines.push(...renderRow(row, false));
	lines.push(rule("╰", "┴", "╯"));
	return lines;
}

function renderCards(header: string[], rows: string[][], ctx: RenderContext): string[] {
	const { style } = ctx;
	const lines: string[] = [];
	const bar = style.fg("mdQuoteBorder", "▎");
	rows.forEach((row, r) => {
		if (r > 0) lines.push("");
		header.forEach((name, i) => {
			const label = style.bold(style.fg("mdHeading", name.replace(/\n/g, " "))) + ": ";
			for (const line of wrap(label + (row[i] ?? ""), Math.max(1, ctx.width - 2))) lines.push(`${bar} ${line}`);
		});
	});
	return lines;
}
