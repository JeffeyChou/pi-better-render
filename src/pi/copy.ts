/**
 * Copying formulas as their Markdown source.
 *
 * In fullscreen mode pi copies a text selection itself: it slices the
 * rendered lines and strips escape sequences, which leaves each formula image
 * as Kitty placeholder characters. Which formula a placeholder cell belongs to
 * is in its foreground color (the image id), so a selection that contains
 * placeholders is read again with escape sequences, and every formula it
 * touches is replaced by the Markdown it was rendered from (`$…$`, `$$…$$`,
 * `\begin{align}…`), whole, even when only part of it was selected.
 *
 * In regular mode the terminal copies the cells itself; an extension cannot
 * change what it puts on the clipboard.
 */
import { sliceByColumn, stripTerminalSequences } from "@earendil-works/pi-tui";
import { diacriticIndex, escapeEnd, PLACEHOLDER, sgrForeground } from "./kitty.ts";

interface FormulaSource {
	/** Markdown source, delimiters included. */
	markdown: string;
	/** Display formula: copied on lines of its own. */
	block: boolean;
}

const SOURCE_LIMIT = 20000;
const sources = new Map<number, FormulaSource>();

/** Remember the Markdown a formula image was rendered from. */
export function rememberFormulaSource(id: number, markdown: string, block: boolean): void {
	sources.delete(id);
	sources.set(id, { markdown, block });
	if (sources.size > SOURCE_LIMIT) {
		const oldest = sources.keys().next().value;
		if (oldest !== undefined) sources.delete(oldest);
	}
}

export function forgetFormulaSources(): void {
	sources.clear();
}

/** Consecutive placeholder cells of one image row. */
interface Run {
	id: number;
	row: number;
	start: number;
	end: number;
	/** The cells as they were (escape sequences removed). */
	text: string;
}

/** Split a line into plain text (escape sequences removed) and runs of placeholder cells. */
function splitLine(line: string): (string | Run)[] {
	const pieces: (string | Run)[] = [];
	let text = "";
	let fg: number | undefined;
	let run: Run | undefined;
	let i = 0;
	while (i < line.length) {
		if (line.charCodeAt(i) === 0x1b) {
			const end = escapeEnd(line, i);
			if (end < 0) break;
			const sequence = line.slice(i, end);
			if (sequence.startsWith("\x1b[") && sequence.endsWith("m")) fg = sgrForeground(sequence.slice(2, -1), fg);
			i = end;
			continue;
		}
		if (line.startsWith(PLACEHOLDER, i)) {
			let j = i + PLACEHOLDER.length;
			const marks: number[] = [];
			while (j < line.length && marks.length < 3) {
				const cp = line.codePointAt(j)!;
				const index = diacriticIndex(cp);
				if (index === undefined) break;
				marks.push(index);
				j += cp > 0xffff ? 2 : 1;
			}
			const cell = line.slice(i, j);
			i = j;
			if (fg === undefined) {
				run = undefined;
				text += cell;
				continue;
			}
			const row = marks[0] ?? 0;
			const column = marks[1] ?? (run && run.row === row ? run.end + 1 : 0);
			if (run && run.id === fg && run.row === row && run.end + 1 === column) {
				run.end = column;
				run.text += cell;
				continue;
			}
			if (text) pieces.push(text);
			text = "";
			run = { id: fg, row, start: column, end: column, text: cell };
			pieces.push(run);
			continue;
		}
		run = undefined;
		const cp = line.codePointAt(i)!;
		const size = cp > 0xffff ? 2 : 1;
		text += line.slice(i, i + size);
		i += size;
	}
	if (text) pieces.push(text);
	return pieces;
}

/**
 * Selected lines (as rendered, with escape sequences) as text, with every
 * formula replaced by its Markdown source. A formula is copied once: further
 * rows of a display formula, and the rest of an inline formula that wrapped
 * onto the next line, are left out. Formulas whose source is unknown stay as
 * they are.
 */
export function selectionWithFormulas(lines: string[]): string {
	const last = new Map<number, { line: number; row: number; end: number }>();
	const out: string[] = [];
	lines.forEach((line, index) => {
		let text = "";
		let onlyFormulas = true;
		let copied = 0;
		let skipped = 0;
		for (const piece of splitLine(line)) {
			if (typeof piece === "string") {
				text += piece;
				if (piece.trim()) onlyFormulas = false;
				continue;
			}
			const source = sources.get(piece.id);
			const previous = last.get(piece.id);
			last.set(piece.id, { line: index, row: piece.row, end: piece.end });
			if (!source) {
				text += piece.text;
				onlyFormulas = false;
				continue;
			}
			const continues =
				previous !== undefined &&
				previous.line === index - 1 &&
				(piece.row === previous.row + 1 || (piece.row === previous.row && piece.start === previous.end + 1));
			if (continues) {
				skipped++;
				continue;
			}
			text += source.markdown;
			copied++;
			if (!source.block) onlyFormulas = false;
		}
		// Display formulas are centered: drop the padding, and the lines of rows already copied.
		if (onlyFormulas && copied === 0 && skipped > 0) return;
		out.push(onlyFormulas && copied > 0 ? text.trim() : text.trimEnd());
	});
	return out.join("\n");
}

interface SelectionPoint {
	row: number;
	col: number;
	scrollView?: unknown;
}

interface LayoutBox {
	scrollView?: unknown;
	scrollContentLines?: string[];
	children?: LayoutBox[];
}

/** The parts of pi-tui's fullscreen TUI (TuiAltScreen) that copying a selection uses. */
export interface SelectionHost {
	getActiveSelectionText(): string | undefined;
	getSelectionBounds?(): { start: SelectionPoint; end: SelectionPoint } | undefined;
	getSelectionColumns?(line: string, row: number, selection: { start: SelectionPoint; end: SelectionPoint }): { start: number; end: number };
	previousScreen?: string[];
	currentLayout?: { root?: LayoutBox };
}

function findScrollBox(box: LayoutBox | undefined, scrollView: unknown): LayoutBox | undefined {
	if (!box) return undefined;
	if (box.scrollView === scrollView) return box;
	for (const child of box.children ?? []) {
		const match = findScrollBox(child, scrollView);
		if (match) return match;
	}
	return undefined;
}

/**
 * The active selection with formulas as Markdown, read the way pi-tui reads
 * it. Undefined when that is not possible, or when the plain text would not
 * match pi's own (a pi version that selects differently): the caller then
 * keeps pi's text.
 */
export function selectionTextWithFormulas(host: SelectionHost, piText: string): string | undefined {
	const selection = host.getSelectionBounds?.();
	if (!selection || typeof host.getSelectionColumns !== "function") return undefined;
	const sourceLines = selection.start.scrollView
		? findScrollBox(host.currentLayout?.root, selection.start.scrollView)?.scrollContentLines
		: host.previousScreen;
	if (!Array.isArray(sourceLines)) return undefined;
	const lines: string[] = [];
	for (let row = selection.start.row; row <= selection.end.row; row++) {
		const line = sourceLines[row] ?? "";
		const columns = host.getSelectionColumns(line, row, selection);
		lines.push(sliceByColumn(line, columns.start, Math.max(0, columns.end - columns.start), true));
	}
	if (lines.map((line) => stripTerminalSequences(line).trimEnd()).join("\n") !== piText) return undefined;
	const text = selectionWithFormulas(lines);
	return text.length > 0 ? text : undefined;
}

/**
 * Make pi's fullscreen selection copy formulas as Markdown. Selections
 * without formula images are left to pi untouched. Returns an uninstaller.
 */
export function installCopyHook(host: SelectionHost | undefined): () => void {
	if (!host || typeof host.getActiveSelectionText !== "function") return () => {};
	const own = Object.prototype.hasOwnProperty.call(host, "getActiveSelectionText");
	const original = host.getActiveSelectionText;
	const hooked = function (this: SelectionHost): string | undefined {
		const text = original.call(this);
		if (!text || !text.includes(PLACEHOLDER)) return text;
		try {
			return selectionTextWithFormulas(this, text) ?? text;
		} catch {
			return text;
		}
	};
	host.getActiveSelectionText = hooked;
	return () => {
		if (host.getActiveSelectionText !== hooked) return;
		if (own) host.getActiveSelectionText = original;
		else delete (host as Partial<SelectionHost>).getActiveSelectionText;
	};
}
