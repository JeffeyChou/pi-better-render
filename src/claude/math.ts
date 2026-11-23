/**
 * MathRenderer for hosts that draw pictures as elements (Claude Code's
 * `Image`), not as terminal escape sequences.
 *
 * A formula becomes a run of marker characters, one per cell, which the core
 * lays out like any word. Each (image, row) pair gets its own code point in
 * Supplementary Private Use Area-B, so layout.ts can find every image again in
 * the finished lines, with its row and the columns it occupies.
 */
import type { MathRenderer } from "../core/render/context.ts";
import { MathError, mathjaxReady, rasterize } from "../core/math/mathjax.ts";

export interface FormulaImage {
	/** PNG, base64. */
	png: string;
	columns: number;
	rows: number;
	tex: string;
	display: boolean;
}

/** Cell size the PNGs are drawn for. The terminal scales each picture to its box, so only the ratio matters. */
export interface CellSize {
	width: number;
	height: number;
}

export const DEFAULT_CELL: CellSize = { width: 9, height: 19 };

const MARK_FIRST = 0x100000;
const MARK_LAST = 0x10fffd;
/** Kitty's placeholder character lives in the same plane; never hand it out. */
const KITTY_PLACEHOLDER = 0x10eeee;
/** Claude Code's Image is at most 255 cells each way. */
const MAX_CELLS = 255;
const MAX_BLOCK_ROWS = 24;

export function isMark(codePoint: number): boolean {
	return codePoint >= MARK_FIRST && codePoint <= MARK_LAST && codePoint !== KITTY_PLACEHOLDER;
}

export interface ImageRegistry {
	images: Map<number, FormulaImage>;
	/** Marker code point → image id and row. */
	marks: Map<number, { id: number; row: number }>;
}

export interface ElementMathOptions {
	/** Whether pictures can be shown at all; false keeps every formula in its Unicode fallback. */
	images: () => boolean;
	color: () => string;
	cell?: CellSize;
}

export interface ElementMathRenderer extends MathRenderer {
	readonly registry: ImageRegistry;
}

let instances = 0;

export function createElementMathRenderer(options: ElementMathOptions): ElementMathRenderer {
	const cell = options.cell ?? DEFAULT_CELL;
	// Rendered lines are cached by key across renderers; markers only mean something to the registry that made them.
	const instance = ++instances;
	const registry: ImageRegistry = { images: new Map(), marks: new Map() };
	const byKey = new Map<string, number | MathError>();
	const rowMarks = new Map<string, number>();
	let nextId = 1;
	let nextMark = MARK_FIRST;

	const markFor = (id: number, row: number): string => {
		const key = `${id}:${row}`;
		let cp = rowMarks.get(key);
		if (cp === undefined) {
			if (nextMark === KITTY_PLACEHOLDER) nextMark++;
			// Out of marks (tens of thousands of formula rows): start over. Lines cached
			// with old marks would point at new images, so callers drop their caches
			// when `key` changes, which includes the generation.
			if (nextMark > MARK_LAST) reset();
			cp = nextMark++;
			rowMarks.set(key, cp);
			registry.marks.set(cp, { id, row });
		}
		return String.fromCodePoint(cp);
	};

	let generation = 0;
	const reset = () => {
		generation++;
		registry.images.clear();
		registry.marks.clear();
		byKey.clear();
		rowMarks.clear();
		nextMark = MARK_FIRST;
	};

	const place = (tex: string, display: boolean, maxColumns: number, maxRows: number): { id: number; image: FormulaImage } | undefined => {
		if (!options.images() || !mathjaxReady()) return undefined;
		const color = options.color();
		const columns = Math.min(maxColumns, MAX_CELLS);
		const key = `${display ? "D" : "I"}\0${columns}\0${maxRows}\0${color}\0${tex}`;
		let entry = byKey.get(key);
		if (entry === undefined) {
			try {
				const raster = rasterize({ tex, display, color, cellWidth: cell.width, cellHeight: cell.height, maxColumns: columns, maxRows, fitRows: !display });
				const id = nextId++;
				registry.images.set(id, { png: raster.base64, columns: raster.columns, rows: raster.rows, tex, display });
				entry = id;
			} catch (error) {
				// Glyph data still loading is not the formula's fault: try again next time.
				if (error instanceof MathError && error.message === "glyphs loading") return undefined;
				entry = error instanceof MathError ? error : new MathError(String(error));
			}
			byKey.set(key, entry);
		}
		if (entry instanceof MathError) return undefined;
		const image = registry.images.get(entry);
		return image ? { id: entry, image } : undefined;
	};

	return {
		registry,
		get key() {
			return `element${instance}|${options.images() ? 1 : 0}|${mathjaxReady() ? 1 : 0}|${options.color()}|${cell.width}x${cell.height}|${generation}`;
		},
		inline(tex) {
			const placed = place(tex, false, MAX_CELLS, 1);
			if (!placed) return undefined;
			return markFor(placed.id, 0).repeat(placed.image.columns);
		},
		block(tex, maxColumns) {
			const placed = place(tex, true, maxColumns, MAX_BLOCK_ROWS);
			if (!placed) return undefined;
			const rows: string[] = [];
			for (let row = 0; row < placed.image.rows; row++) rows.push(markFor(placed.id, row).repeat(placed.image.columns));
			return rows;
		},
	};
}
