/**
 * The committed Claude Code bundle (plugins/claude/lib) end to end, in Node:
 * resvg-wasm from lib/resvg.wasm, MathJax glyph data loaded on demand from
 * lib/glyphs/*.json through the same callback the mod uses ($.fs.read there).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const lib = new URL("../plugins/claude/lib/", import.meta.url);
// @ts-ignore: the bundle's types are lib/better-render.d.mts
const bundle: typeof import("../plugins/claude/lib/better-render.mjs") = await import(new URL("better-render.mjs", lib).href);

const loaded: string[] = [];
await bundle.start({
	wasm: () => WebAssembly.compile(readFileSync(new URL("resvg.wasm", lib))),
	readGlyphs: async (name: string) => {
		loaded.push(name);
		return JSON.parse(readFileSync(new URL(`glyphs/${name}.json`, lib), "utf8"));
	},
});

const images = (plan: Awaited<ReturnType<typeof bundle.renderText>>) =>
	plan.parts.flatMap((p) => (p.kind === "rich" ? p.rows : [])).flatMap((r) => (r.kind === "band" ? [r.image] : r.segments.filter((s) => s.kind === "image")));

test("claude bundle: loads MathJax and resvg-wasm", () => {
	assert.equal(bundle.engineStatus(), "MathJax + resvg-wasm");
});

test("claude bundle: formulas that need on-demand glyph data become pictures", async () => {
	const text = "Lie algebra $\\mathfrak{g}$, sets $\\mathcal{A} \\subseteq \\mathbb{R}$, arrows $A \\xrightarrow{f} B \\Longleftrightarrow C$ and $\\text{Δ}$.";
	const plan = await bundle.renderText(text, { width: 80, images: true, mathColor: "#ffffff" });
	const pictures = images(plan);
	assert.equal(pictures.length, 4, JSON.stringify(plan.parts.map((p) => p.kind)));
	for (const p of pictures) assert.ok(p.image.png.startsWith("iVBORw0KGgo"));
	assert.ok(loaded.includes("fraktur"), `glyph files loaded: ${loaded.join(", ")}`);
});

test("claude bundle: a formula with CJK in \\text stays text (no text fonts in the sandbox)", async () => {
	const plan = await bundle.renderText("面积 $S = \\text{长} \\times \\text{宽}$", { width: 80, images: true, mathColor: "#ffffff" });
	assert.equal(images(plan).length, 0);
	const text = JSON.stringify(plan);
	assert.match(text, /长/);
});

test("claude bundle: the acceptance reply renders with pictures and an aligned table", async () => {
	const reply = "| 方法 | 复杂度 |\n| --- | --- |\n| 快速排序 | $O(n \\log n)$ |\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$";
	const plan = await bundle.renderText(reply, { width: 60, images: true, mathColor: "#000000" });
	assert.equal(plan.rich, true);
	const pictures = images(plan);
	assert.equal(pictures.length, 2);
	assert.ok(pictures.some((p) => p.rows > 1));
});
