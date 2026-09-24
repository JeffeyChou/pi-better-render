/**
 * TeX → SVG (MathJax 4, in process) → PNG (resvg, in process).
 *
 * Both steps are synchronous and take ~1 ms per formula once MathJax is loaded,
 * so formulas can be rasterized inside a render pass while text streams in.
 * Loading MathJax takes ~200 ms, so it happens in the background after
 * session_start; until then formulas use the Unicode fallback.
 *
 * Canvas sizing follows the terminal cell grid exactly (columns × rows cells),
 * so Kitty never has to stretch the image. Scale: 1ex ≈ 0.5 × cell height,
 * which makes formula text match the terminal font size (same as pi-math).
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { textFontOptions } from "./cjk-font.ts";

export interface Raster {
	base64: string;
	columns: number;
	rows: number;
}

export interface RasterRequest {
	tex: string;
	display: boolean;
	color: string;
	cellWidth: number;
	cellHeight: number;
	maxColumns: number;
	/** Force the result into this many rows (1 for inline formulas). */
	maxRows: number;
	fitRows?: boolean;
}

export class MathError extends Error {}

const EX_TO_CELL = 0.5;
const MAX_CANVAS = 4096;
const BLEED = 1;

interface Engine {
	toSvg(tex: string, display: boolean): string;
	Resvg: any;
}

let engine: Engine | undefined;
let loading: Promise<boolean> | undefined;
let loadError: string | undefined;

export function mathjaxReady(): boolean {
	return engine !== undefined;
}

export function mathjaxError(): string | undefined {
	return loadError;
}

/** Common LaTeX macros that no MathJax package defines. */
const MACROS = {
	bm: ["\\boldsymbol{#1}", 1],
	llbracket: "\\mathopen{\u27E6}",
	rrbracket: "\\mathclose{\u27E7}",
};

/**
 * A tagged display is a 100%-wide SVG (the tag sits at the right margin), which
 * has no size to fit onto the cell grid. Pin it to its minimum width so the tag
 * follows the formula at minimum spacing. Its content is laid out in pixels
 * (the first group scales font units by `s`), so the viewBox is the natural
 * size in font units times `s`.
 */
function fixFullWidth(svg: string): string {
	const open = /^<svg\b[^>]*>/.exec(svg)?.[0];
	if (!open?.includes(' width="100%"')) return svg;
	const minWidth = Number(/min-width:\s*([\d.]+)ex/.exec(open)?.[1]);
	const box = /\sdata-mjx-viewBox="([^"]+)"/.exec(open)?.[1]?.split(/\s+/).map(Number);
	const scale = Number(/^<svg\b[^>]*>\s*<g[^>]*\stransform="scale\(([\d.]+)/.exec(svg)?.[1]);
	if (!(minWidth > 0) || box?.length !== 4 || !(scale > 0)) return svg;
	const fixed = open
		.replace(' width="100%"', ` width="${minWidth}ex"`)
		.replace(/\sdata-mjx-viewBox="[^"]+"/, ` viewBox="0 0 ${box[2]! * scale} ${box[3]! * scale}"`);
	return fixed + svg.slice(open.length);
}

/** MathJax modules: the trimmed bundle when built (published package), else node_modules (development). */
function loadLibrary(): any {
	const require = createRequire(import.meta.url);
	const bundle = fileURLToPath(new URL("../../vendor/mathjax.cjs", import.meta.url));
	return require(existsSync(bundle) ? bundle : "./mathjax-lib.cjs");
}

export function mathjaxBundled(): boolean {
	return library?.bundled === true;
}

let library: any;

function createEngine(): Engine {
	const require = createRequire(import.meta.url);
	library = loadLibrary();
	const { mathjax, liteAdaptor, RegisterHTMLHandler, TeX, SVG, MathJaxNewcmFont, packages: PACKAGES } = library;
	const { Resvg } = require("@resvg/resvg-js");

	const adaptor = liteAdaptor({ cjkCharWidth: 1, unknownCharWidth: 0.6, unknownCharHeight: 0.8 });
	RegisterHTMLHandler(adaptor);
	const input = new TeX({
		packages: PACKAGES,
		macros: MACROS,
		maxBuffer: 20_000,
		maxMacros: 1_000,
		formatError: (_jax: unknown, error: Error) => {
			throw error;
		},
	});
	// Inline line breaking would split a formula into several <svg> pieces; the terminal wraps cells instead.
	const output = new SVG({ fontData: MathJaxNewcmFont, fontCache: "none", mtextInheritFont: true, linebreaks: { inline: false } });
	const doc = mathjax.document("", { InputJax: input, OutputJax: output });
	// Text MathJax has no glyphs for (CJK in \text{…}) is measured at 1em per character. Declaring the
	// surrounding font's x-height equal to the math font's makes MathJax draw it at 1em too, instead
	// of scaling it to a 0.5em x-height, which left a gap after it.
	const metrics = { em: 16, ex: 16 * output.font.params.x_height };
	return {
		toSvg(tex, display) {
			input.reset?.();
			const node = doc.convert(tex, { display, ...metrics });
			const html: string = adaptor.outerHTML(node);
			const start = html.indexOf("<svg");
			const end = html.lastIndexOf("</svg>");
			if (start < 0 || end < start) throw new MathError("MathJax produced no SVG");
			// data-latex repeats the TeX source unescaped (a "<" would break the XML); resvg does not need it.
			const svg = fixFullWidth(html.slice(start, end + 6).replace(/\sdata-latex="[^"]*"/g, ""));
			if (svg.includes('data-mml-node="merror"')) throw new MathError("TeX error");
			return svg;
		},
		Resvg,
	};
}

/** Load MathJax + resvg (idempotent). Resolves false if the packages are unavailable. */
export function loadMathJax(): Promise<boolean> {
	if (engine) return Promise.resolve(true);
	loading ??= new Promise<boolean>((resolve) => {
		setTimeout(() => {
			try {
				engine = createEngine();
				resolve(true);
			} catch (error) {
				loadError = error instanceof Error ? error.message : String(error);
				resolve(false);
			}
		}, 0);
	});
	return loading;
}

/** Synchronous load for tests and benchmarks. */
export function loadMathJaxSync(): void {
	engine ??= createEngine();
}

const svgCache = new Map<string, { svg: string; widthEx: number; heightEx: number } | MathError>();

function svgFor(tex: string, display: boolean): { svg: string; widthEx: number; heightEx: number } {
	if (!engine) throw new MathError("MathJax not loaded");
	const key = `${display ? "D" : "I"}\0${tex}`;
	let entry = svgCache.get(key);
	if (!entry) {
		try {
			const svg = engine.toSvg(tex, display);
			const widthEx = Number(/\swidth="([\d.]+)ex"/.exec(svg)?.[1]);
			const heightEx = Number(/\sheight="([\d.]+)ex"/.exec(svg)?.[1]);
			if (!(widthEx > 0) || !(heightEx > 0)) throw new MathError("SVG without ex dimensions");
			entry = { svg, widthEx, heightEx };
		} catch (error) {
			entry = error instanceof MathError ? error : new MathError(error instanceof Error ? error.message : String(error));
		}
		if (svgCache.size > 2000) svgCache.clear();
		svgCache.set(key, entry);
	}
	if (entry instanceof MathError) throw entry;
	return entry;
}

/** Validate a formula without rasterizing it. */
export function checkTex(tex: string, display: boolean): void {
	svgFor(tex, display);
}

/** Wrap any SVG body so it is centered on a canvas of exact pixel size. */
export function centeredCanvas(inner: string, contentW: number, contentH: number, canvasW: number, canvasH: number, color: string): string {
	const x = Math.max(0, (canvasW - contentW) / 2);
	const y = Math.max(0, (canvasH - contentH) / 2);
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}" color="${color}">` +
		inner.replace(/^<svg\b/, `<svg x="${x}" y="${y}" overflow="visible"`).replace(/\s(width|height)="[\d.]+ex"/g, (_m, dim) => ` ${dim}="${dim === "width" ? contentW : contentH}"`) +
		"</svg>"
	);
}

export function rasterizeSvg(svg: string): Buffer {
	if (!engine) throw new MathError("resvg not loaded");
	return engine.Resvg
		? new engine.Resvg(svg, {
				font: svg.includes("<text") ? textFontOptions(svg) : { loadSystemFonts: false },
				shapeRendering: 2,
				textRendering: 2,
				logLevel: "error",
			})
				.render()
				.asPng()
		: Buffer.alloc(0);
}

/** Device pixels per logical pixel: small reported cells are likely logical (non-retina) pixels. */
function deviceScale(cellHeight: number): number {
	return cellHeight < 24 ? 2 : 1;
}

export function rasterize(req: RasterRequest): Raster {
	const { svg, widthEx, heightEx } = svgFor(req.tex, req.display);
	const cellW = Math.max(1, req.cellWidth);
	const cellH = Math.max(1, req.cellHeight);
	const maxW = req.maxColumns * cellW - BLEED * 2;
	const maxH = req.maxRows * cellH - BLEED * 2;
	if (maxW <= 0 || maxH <= 0) throw new MathError("no room");

	const base = cellH * EX_TO_CELL;
	let pxPerEx = Math.min(base, maxW / widthEx);
	if (req.fitRows) pxPerEx = Math.min(pxPerEx, maxH / heightEx);
	// Shrinking below ~55% makes formulas unreadable: prefer the text fallback.
	if (pxPerEx < base * 0.55) throw new MathError("formula too large for the terminal");

	const contentW = widthEx * pxPerEx;
	const contentH = heightEx * pxPerEx;
	const columns = Math.max(1, Math.min(req.maxColumns, Math.ceil((contentW + BLEED * 2) / cellW - 1e-9)));
	const rows = Math.max(1, Math.ceil((contentH + BLEED * 2) / cellH - 1e-9));
	if (rows > req.maxRows) throw new MathError(`formula needs ${rows} rows`);

	const scale = deviceScale(cellH);
	const canvasW = Math.ceil(columns * cellW * scale);
	const canvasH = Math.ceil(rows * cellH * scale);
	if (canvasW > MAX_CANVAS || canvasH > MAX_CANVAS) throw new MathError("raster too large");
	const png = rasterizeSvg(centeredCanvas(svg, contentW * scale, contentH * scale, canvasW, canvasH, req.color));
	return { base64: png.toString("base64"), columns, rows };
}
