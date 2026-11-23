/**
 * Entry of the Claude Code plugin's render library (bundled by
 * tools/build-claude.mjs into plugins/claude/lib/).
 *
 * Claude Code runs a mod in a sandbox without Node: the library gets MathJax
 * as an ES module, rasterizes with resvg-wasm (compiled by the mod through
 * `$.wasm.compile`), and loads MathJax's on-demand glyph data as JSON through
 * the `readGlyphs` callback the mod passes in (`$.fs.read`), because the
 * sandbox caps what a mod may import.
 */
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import library from "../core/math/mathjax-lib.cjs";
import { loadMathJaxSync, MathError, mathjaxError, mathjaxReady, setMathBackend } from "../core/math/mathjax.ts";
import { createElementMathRenderer, DEFAULT_CELL, type ElementMathRenderer } from "./math.ts";
import { planMessage, type MessagePlan } from "./message.ts";

export { formulaAlt, mightNeedCore, type MessagePlan, type Part } from "./message.ts";
export type { Row, Segment, TextRun } from "./layout.ts";
export { MATH_COLORS, themeAppearance } from "./style.ts";
export { visibleWidth } from "../core/text.ts";

export interface Host {
	/** The compiled resvg-wasm module. */
	wasm(): Promise<WebAssembly.Module>;
	/** Arguments of MathJax's `dynamicSetup` for one glyph file (`latin`, `arrows`, …). */
	readGlyphs(name: string): Promise<unknown[]>;
}

const DYNAMIC = /dynamic\/([\w.-]+?)(?:\.js)?$/;
let host: Host | undefined;

library.mathjax.asyncIsSynchronous = false;
library.mathjax.asyncLoad = async (name: string) => {
	const file = DYNAMIC.exec(name)?.[1];
	if (!file || !host) throw new Error(`cannot load ${name}`);
	const args = await host.readGlyphs(file);
	library.MathJaxNewcmFont.dynamicSetup(...args);
	return {};
};

setMathBackend({
	loadLibrary: () => library,
	rasterizeSvg(svg) {
		// No text fonts in the sandbox: a formula with <text> (CJK in \text{…}) keeps its text form.
		if (svg.includes("<text")) throw new MathError("formula needs a text font");
		return new Resvg(svg, { font: { loadSystemFonts: false }, shapeRendering: 2, textRendering: 2 }).render().asPng();
	},
});

let starting: Promise<boolean> | undefined;

/** Load resvg-wasm and MathJax once per mod environment. */
export function start(next: Host): Promise<boolean> {
	host = next;
	starting ??= (async () => {
		try {
			await initWasm(await next.wasm());
			// The sandbox has no timers to defer to; loading takes ~50 ms.
			loadMathJaxSync();
			return true;
		} catch (error) {
			starting = undefined;
			throw error;
		}
	})();
	return starting;
}

export function engineStatus(): string {
	if (mathjaxReady()) return "MathJax + resvg-wasm";
	return mathjaxError() ? `unavailable (${mathjaxError()})` : "not loaded";
}

export interface RenderSettings {
	width: number;
	images: boolean;
	mathColor: string;
	cellAspect?: number;
}

const renderers = new Map<string, ElementMathRenderer>();
const plans = new Map<string, MessagePlan>();
const PLAN_LIMIT = 300;

function rendererFor(settings: RenderSettings): ElementMathRenderer {
	const aspect = settings.cellAspect && settings.cellAspect > 1 ? settings.cellAspect : DEFAULT_CELL.height / DEFAULT_CELL.width;
	const key = `${settings.images}|${settings.mathColor}|${aspect}`;
	let renderer = renderers.get(key);
	if (!renderer) {
		renderer = createElementMathRenderer({
			images: () => settings.images,
			color: () => settings.mathColor,
			cell: { width: DEFAULT_CELL.width, height: Math.round(DEFAULT_CELL.width * aspect) },
		});
		renderers.set(key, renderer);
	}
	return renderer;
}

/** Plan a text block for drawing (cached per text and settings). */
export async function renderText(text: string, settings: RenderSettings): Promise<MessagePlan> {
	const math = rendererFor(settings);
	const key = `${settings.width}\0${math.key}\0${text}`;
	const hit = plans.get(key);
	if (hit) return hit;
	const plan = await planMessage(text, { width: settings.width, math, mathColor: settings.mathColor });
	plans.set(key, plan);
	if (plans.size > PLAN_LIMIT) plans.delete(plans.keys().next().value!);
	return plan;
}
