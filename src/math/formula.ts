/**
 * MathRenderer used by the Markdown renderer: formula → Kitty placeholder text.
 *
 * Returns undefined (→ Unicode/source fallback) whenever images are not
 * possible: unsupported terminal, math disabled, MathJax still loading, or the
 * formula failed everywhere. MathJax failures are retried with a local TeX
 * engine in the background when one is installed.
 */
import { getCapabilities, getCellDimensions, getPngDimensions } from "@earendil-works/pi-tui";
import type { MathRenderer } from "../render/context.ts";
import { bumpVersion, requestRender, state } from "../state.ts";
import { allocateId, ensureTransmitted, MAX_PLACEHOLDER_CELLS, placeholderRows, placeholderTerminal } from "./kitty.ts";
import { centeredCanvas, MathError, mathjaxReady, type Raster, rasterize, rasterizeSvg } from "./mathjax.ts";
import { detectTexBackend } from "./tex-backend.ts";

interface Placed extends Raster {
	id: number;
}

const MAX_BLOCK_ROWS = 24;
const CACHE_LIMIT = 1500;

const rasters = new Map<string, Placed | MathError>();
/** TeX-engine results (PNG + pixel size), keyed without layout so they survive resizes. */
const texResults = new Map<string, { png: string; width: number; height: number } | Error | "pending">();

export const mathStats = { rendered: 0, failed: 0, texRendered: 0, totalMs: 0 };

export function clearFormulaCache(): void {
	rasters.clear();
	texResults.clear();
	mathStats.rendered = mathStats.failed = mathStats.texRendered = mathStats.totalMs = 0;
}

export function imagesAvailable(): boolean {
	return getCapabilities().images === "kitty" && placeholderTerminal();
}

function remember(key: string, value: Placed | MathError): Placed | MathError {
	if (rasters.size >= CACHE_LIMIT) {
		const oldest = rasters.keys().next().value;
		if (oldest !== undefined) rasters.delete(oldest);
	}
	rasters.set(key, value);
	return value;
}

function texKey(tex: string, display: boolean, color: string): string {
	return `${display ? "D" : "I"}\0${color}\0${tex}`;
}

/** Queue a TeX-engine render; bumps the render version when it lands. */
function requestTex(tex: string, display: boolean, color: string, cellHeight: number): void {
	const backend = detectTexBackend();
	if (!backend) return;
	const key = texKey(tex, display, color);
	if (texResults.has(key)) return;
	texResults.set(key, "pending");
	// 12pt Computer Modern: 1ex ≈ 5.16pt. Aim for 1ex ≈ 0.5 cell height, at 2× for crispness.
	const dpi = ((0.5 * cellHeight * 2) * 72.27) / 5.16;
	enqueue(async () => {
		try {
			const png = await backend.render(tex, display, color, dpi);
			const base64 = png.toString("base64");
			const dims = getPngDimensions(base64);
			if (!dims) throw new Error("invalid PNG from TeX");
			texResults.set(key, { png: base64, width: dims.widthPx / 2, height: dims.heightPx / 2 });
			mathStats.texRendered++;
		} catch (error) {
			texResults.set(key, error instanceof Error ? error : new Error(String(error)));
		}
		bumpVersion();
		requestRender();
	});
}

let queue: Promise<void> = Promise.resolve();
function enqueue(job: () => Promise<void>): void {
	queue = queue.then(job, job);
}

/** Fit a TeX-engine PNG onto the cell grid (via resvg, so Kitty never stretches it). */
function placeTexResult(result: { png: string; width: number; height: number }, cellW: number, cellH: number, maxColumns: number, maxRows: number): Raster {
	let w = result.width;
	let h = result.height;
	const maxW = maxColumns * cellW - 2;
	const maxH = maxRows * cellH - 2;
	const shrink = Math.min(1, maxW / w, maxH / h);
	if (shrink < 0.55) throw new MathError("TeX image too large");
	w *= shrink;
	h *= shrink;
	const columns = Math.max(1, Math.ceil((w + 2) / cellW));
	const rows = Math.max(1, Math.ceil((h + 2) / cellH));
	const scale = 2;
	const inner = `<svg width="${w * scale}" height="${h * scale}"><image width="${w * scale}" height="${h * scale}" href="data:image/png;base64,${result.png}"/></svg>`;
	const png = rasterizeSvg(centeredCanvas(inner, w * scale, h * scale, columns * cellW * scale, rows * cellH * scale, "#000000"));
	return { base64: png.toString("base64"), columns, rows };
}

/**
 * MathJax could not typeset a formula. Size-limit failures are final; TeX
 * errors are retried with a local TeX engine when one is installed.
 */
function fallbackToTex(
	failure: MathError,
	tex: string,
	display: boolean,
	color: string,
	cellW: number,
	cellH: number,
	maxColumns: number,
	maxRows: number,
): Raster | MathError | "pending" {
	if (/too large|rows|no room|raster/.test(failure.message) || !detectTexBackend()) return failure;
	const result = texResults.get(texKey(tex, display, color));
	if (result === undefined) {
		requestTex(tex, display, color, cellH);
		return "pending";
	}
	if (result === "pending") return "pending";
	if (result instanceof Error) return failure;
	try {
		return placeTexResult(result, cellW, cellH, maxColumns, maxRows);
	} catch (error) {
		return error instanceof MathError ? error : failure;
	}
}

export function createMathRenderer(getColor: () => string): MathRenderer {
	const active = (streaming: boolean) =>
		state.math !== "off" && !(state.math === "final" && streaming) && mathjaxReady() && imagesAvailable();

	const place = (tex: string, display: boolean, maxColumns: number, maxRows: number): Placed | undefined => {
		const color = getColor();
		const cell = getCellDimensions();
		const columns = Math.min(maxColumns, MAX_PLACEHOLDER_CELLS);
		const key = `${display ? "D" : "I"}\0${columns}\0${maxRows}\0${cell.widthPx}x${cell.heightPx}\0${color}\0${tex}`;
		let entry = rasters.get(key);
		if (!entry) {
			const started = performance.now();
			try {
				const raster = rasterize({ tex, display, color, cellWidth: cell.widthPx, cellHeight: cell.heightPx, maxColumns: columns, maxRows, fitRows: !display });
				entry = remember(key, { ...raster, id: allocateId() });
				mathStats.rendered++;
			} catch (error) {
				const failure = error instanceof MathError ? error : new MathError(String(error));
				const outcome = fallbackToTex(failure, tex, display, color, cell.widthPx, cell.heightPx, columns, maxRows);
				if (outcome === "pending") return undefined;
				entry = remember(key, outcome instanceof MathError ? outcome : { ...outcome, id: allocateId() });
				if (entry instanceof MathError) mathStats.failed++;
			}
			mathStats.totalMs += performance.now() - started;
		}
		if (entry instanceof MathError) return undefined;
		ensureTransmitted(entry.id, entry.base64, entry.columns, entry.rows);
		return entry;
	};

	return {
		get key() {
			return `${state.math}|${mathjaxReady() ? 1 : 0}|${imagesAvailable() ? 1 : 0}|${getColor()}|${getCellDimensions().widthPx}x${getCellDimensions().heightPx}`;
		},
		inline(tex, _display, streaming) {
			if (!active(streaming)) return undefined;
			const placed = place(tex, false, MAX_PLACEHOLDER_CELLS, 1);
			return placed ? placeholderRows(placed.id, placed.columns, 1)[0] : undefined;
		},
		block(tex, maxColumns, streaming) {
			if (!active(streaming)) return undefined;
			const placed = place(tex, true, maxColumns, MAX_BLOCK_ROWS);
			return placed ? placeholderRows(placed.id, placed.columns, placed.rows) : undefined;
		},
	};
}
