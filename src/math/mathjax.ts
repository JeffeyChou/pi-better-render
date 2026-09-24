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

/**
 * TeX packages to load. Left out: html/texhtml (raw HTML/CSS), noerrors/noundefined
 * (would hide errors we want to surface), require/autoload/setoptions (runtime
 * loading and reconfiguration), colorv2/fontsizev3 (v2/v3 compatibility variants).
 */
const PACKAGES = [
	"base", "action", "ams", "amscd", "bbm", "bboldx", "bbox", "begingroup", "boldsymbol", "braket",
	"bussproofs", "cancel", "cases", "centernot", "color", "colortbl", "configmacros", "dsfont", "empheq",
	"enclose", "extpfeil", "gensymb", "mathtools", "mhchem", "newcommand", "physics", "tagformat",
	"textcomp", "textmacros", "unicode", "units", "upgreek", "verb",
];

/** Package directory → configuration module, where the file name is not <Name>Configuration.js. */
const CONFIG_FILE: Record<string, string> = {
	amscd: "AmsCdConfiguration",
	configmacros: "ConfigMacrosConfiguration",
	tagformat: "TagFormatConfiguration",
	textmacros: "TextMacrosConfiguration",
};

/** Font extensions that some packages need for their glyphs. */
const FONT_EXTENSIONS: Record<string, string> = {
	mhchem: "@mathjax/mathjax-mhchem-font-extension/js/svg.js",
	bbm: "@mathjax/mathjax-bbm-font-extension/js/svg.js",
	bboldx: "@mathjax/mathjax-bboldx-font-extension/js/svg.js",
	dsfont: "@mathjax/mathjax-dsfont-font-extension/js/svg.js",
};

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

function createEngine(): Engine {
	const require = createRequire(import.meta.url);
	const { mathjax } = require("@mathjax/src/js/mathjax.js");
	// Font data for less common characters is split into files loaded on demand; load them synchronously.
	mathjax.asyncLoad = (name: string) => require(name);
	mathjax.asyncIsSynchronous = true;
	const { liteAdaptor } = require("@mathjax/src/js/adaptors/liteAdaptor.js");
	const { RegisterHTMLHandler } = require("@mathjax/src/js/handlers/html.js");
	const { TeX } = require("@mathjax/src/js/input/tex.js");
	const { SVG } = require("@mathjax/src/js/output/svg.js");
	const { MathJaxNewcmFont } = require("@mathjax/mathjax-newcm-font/js/svg.js");
	const { Resvg } = require("@resvg/resvg-js");

	const texDir = "@mathjax/src/js/input/tex";
	for (const name of PACKAGES) {
		const file = CONFIG_FILE[name] ?? `${name[0]!.toUpperCase()}${name.slice(1)}Configuration`;
		require(`${texDir}/${name}/${file}.js`);
		const extension = FONT_EXTENSIONS[name];
		if (extension) {
			const data = Object.values(require(extension))[0];
			MathJaxNewcmFont.addExtension(data, extension.replace(/\.js$/, "/dynamic"));
		}
	}

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

/**
 * Fonts for text MathJax leaves as <text> (\\text{…} with CJK and other characters
 * outside its fonts). Loading every system font costs ~100 ms per image; a few
 * files with wide coverage cost ~10 ms. Falls back to all system fonts.
 */
const TEXT_FONT_CANDIDATES = [
	"/System/Library/Fonts/Hiragino Sans GB.ttc",
	"/System/Library/Fonts/STHeiti Medium.ttc",
	"/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
	"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
	"/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
	"/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
	"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
	"C:\\Windows\\Fonts\\msyh.ttc",
	"C:\\Windows\\Fonts\\arial.ttf",
];
let textFonts: string[] | undefined;

function textFontOptions(): { loadSystemFonts: boolean; fontFiles?: string[] } {
	textFonts ??= TEXT_FONT_CANDIDATES.filter((file) => existsSync(file)).slice(0, 2);
	return textFonts.length > 0 ? { loadSystemFonts: false, fontFiles: textFonts } : { loadSystemFonts: true };
}

export function rasterizeSvg(svg: string): Buffer {
	if (!engine) throw new MathError("resvg not loaded");
	return engine.Resvg
		? new engine.Resvg(svg, {
				font: svg.includes("<text") ? textFontOptions() : { loadSystemFonts: false },
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
