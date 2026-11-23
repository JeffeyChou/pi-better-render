/**
 * Build plugins/claude/lib/: everything the Claude Code plugin runs, so an
 * install from the marketplace needs no npm install, build step or repo.
 *
 *   lib/better-render.mjs + c-*.mjs  src/claude/index.ts with the shared core, MathJax,
 *                                    marked and resvg-wasm's glue, as ES module chunks
 *   lib/resvg.wasm                   resvg (SVG → PNG), compiled by the mod via $.wasm.compile
 *   lib/glyphs/*.json                MathJax's on-demand glyph data, read via $.fs.read
 *   lib/LICENSES.md                  licenses of the bundled packages
 *
 * Claude Code refuses a mod whose imported files exceed 1 MiB each or 8 MiB
 * together, so the bundle is split into chunks along a few extra entry points,
 * and MathJax's 10 MB of rarely needed glyph data is data (JSON), not code.
 * Run by `npm run build`; lib/ is committed and the output is deterministic.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "plugins", "claude", "lib");
const require = createRequire(join(root, "package.json"));
const nodeModules = join(root, "node_modules");

const FILE_LIMIT = 1024 * 1024;
const TOTAL_LIMIT = 8 * 1024 * 1024;
/** Leave room under Claude Code's total for the mod's own files. */
const TOTAL_BUDGET = TOTAL_LIMIT - 512 * 1024;

rmSync(lib, { recursive: true, force: true });
mkdirSync(join(lib, "glyphs"), { recursive: true });

// Extra entry points only steer chunking: modules reachable from the same set of
// entries share a chunk, so each of these ends up in a chunk of its own size.
const PARTS = {
	"part-font": "@mathjax/mathjax-newcm-font/cjs/svg.js",
	"part-normal": "@mathjax/mathjax-newcm-font/cjs/svg/normal.js",
	"part-extensions": [
		"@mathjax/mathjax-bbm-font-extension/cjs/svg.js",
		"@mathjax/mathjax-bboldx-font-extension/cjs/svg.js",
		"@mathjax/mathjax-dsfont-font-extension/cjs/svg.js",
		"@mathjax/mathjax-mhchem-font-extension/cjs/svg.js",
	],
	"part-tex": "@mathjax/src/cjs/input/tex.js",
	"part-svg": "@mathjax/src/cjs/output/svg.js",
};

/** pi-tui without its terminal, image and Node code: only what src/core/text.ts re-exports. */
const PI_TUI_SHIM = `
export { Marked } from "marked";
export { renderLatex } from "@earendil-works/pi-tui/dist/latex.js";
export { sliceByColumn, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui/dist/utils.js";
`;

const virtualModules = {
	name: "virtual-modules",
	setup(b) {
		b.onResolve({ filter: /^@earendil-works\/pi-tui$/ }, () => ({ path: "pi-tui", namespace: "virtual" }));
		b.onResolve({ filter: /^node:path$/ }, () => ({ path: "node-path", namespace: "virtual" }));
		b.onResolve({ filter: /^part:/ }, (args) => ({ path: args.path.slice(5), namespace: "virtual" }));
		b.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
			if (args.path === "pi-tui") return { contents: PI_TUI_SHIM, loader: "js", resolveDir: root };
			// mathjax-lib.cjs only uses node:path in the asyncLoad that index.ts replaces.
			if (args.path === "node-path") return { contents: "module.exports = {};", loader: "js" };
			const specs = [PARTS[args.path]].flat();
			return { contents: specs.map((s) => `import ${JSON.stringify(s)};`).join("\n"), loader: "js", resolveDir: root };
		});
	},
};

const entryPoints = { "better-render": join(root, "src/claude/index.ts") };
for (const name of Object.keys(PARTS)) entryPoints[name] = `part:${name}`;

const result = await build({
	entryPoints,
	outdir: lib,
	bundle: true,
	splitting: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	nodePaths: [nodeModules],
	target: "es2022",
	minify: true,
	legalComments: "none",
	chunkNames: "c-[hash]",
	outExtension: { ".js": ".mjs" },
	define: {
		__MATHJAX_BUNDLED__: "false",
		// tslib's __generator gives generator objects Iterator.prototype, which the mod
		// sandbox freezes; assigning their methods then throws. Plain objects work.
		Iterator: "undefined",
	},
	plugins: [virtualModules],
	metafile: true,
	logLevel: "warning",
});

// Nothing Node- or terminal-specific may sneak in.
const inputs = Object.keys(result.metafile.inputs);
const unwanted = inputs.filter((f) => /speech-rule-engine|mj-context-menu|[\\/]a11y[\\/]|[\\/]chtml[\\/.]|pi-tui[\\/]dist[\\/](?!utils|latex)|resvg-js|src[\\/]pi[\\/]/.test(f));
if (unwanted.length > 0) throw new Error(`unexpected modules in the Claude bundle:\n${unwanted.join("\n")}`);

let total = 0;
for (const file of readdirSync(lib).filter((f) => f.endsWith(".mjs"))) {
	const size = statSync(join(lib, file)).size;
	if (size >= FILE_LIMIT) throw new Error(`${file} is ${size} bytes; Claude Code imports at most ${FILE_LIMIT} per file. Add a part entry.`);
	total += size;
}
if (total > TOTAL_BUDGET) throw new Error(`lib/*.mjs total ${total} bytes, over the ${TOTAL_BUDGET} budget (Claude Code's limit is ${TOTAL_LIMIT})`);

copyFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm"), join(lib, "resvg.wasm"));

// On-demand glyph files: run each with a stand-in font class that records its dynamicSetup call.
const glyphDir = join(dirname(require.resolve("@mathjax/mathjax-newcm-font/cjs/svg.js")), "svg", "dynamic");
let glyphBytes = 0;
const glyphFiles = readdirSync(glyphDir).filter((f) => f.endsWith(".js")).sort();
for (const file of glyphFiles) {
	let args;
	const stand = { MathJaxNewcmFont: { dynamicSetup: (...a) => (args = a) } };
	const localRequire = (spec) => (spec === "../../svg.js" ? stand : require(spec));
	const module = { exports: {} };
	new Function("require", "module", "exports", readFileSync(join(glyphDir, file), "utf8"))(localRequire, module, module.exports);
	if (!args) throw new Error(`${file}: no dynamicSetup call`);
	const json = JSON.stringify(args, (_key, value) => {
		if (typeof value === "function") throw new Error(`${file}: glyph data holds a function`);
		return value;
	});
	if (json.length > 4 * 1024 * 1024) throw new Error(`${file}: over $.fs.read's 4 MiB`);
	writeFileSync(join(lib, "glyphs", file.replace(/\.js$/, ".json")), json);
	glyphBytes += json.length;
}

const pkg = (name) => JSON.parse(readFileSync(join(nodeModules, name, "package.json"), "utf8"));
const bundled = new Set(inputs.map((f) => /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(f)?.[1]?.replace("\\", "/")).filter(Boolean));
bundled.add("@resvg/resvg-wasm");
const rows = [...bundled].sort().map((name) => {
	const p = pkg(name);
	return `- ${name} ${p.version} (${p.license})`;
});
// License texts travel with the plugin, which is installed without the rest of the repository.
mkdirSync(join(lib, "licenses"), { recursive: true });
copyFileSync(require.resolve("@mathjax/src/LICENSE"), join(lib, "licenses", "Apache-2.0.txt"));
for (const name of bundled) {
	const dir = join(nodeModules, name);
	const file = readdirSync(dir).find((f) => /^licen[cs]e(\.md|\.txt)?$/i.test(f));
	if (file) copyFileSync(join(dir, file), join(lib, "licenses", `${name.replace("/", "__")}.txt`));
}
writeFileSync(
	join(lib, "LICENSES.md"),
	`# Bundled software

Generated by tools/build-claude.mjs. Do not edit.

The files in this folder bundle the packages below; their license texts are in
licenses/. MathJax, its fonts and mhchemparser are Apache-2.0
(licenses/Apache-2.0.txt). resvg.wasm is resvg-wasm, MPL-2.0, source at
https://github.com/thx/resvg-js and https://mozilla.org/MPL/2.0/.

${rows.join("\n")}
`,
);

// The mod imports the bundle; these are its types (src/claude/index.ts is the source of truth).
writeFileSync(
	join(lib, "better-render.d.mts"),
	`// Generated by tools/build-claude.mjs from src/claude/index.ts. Do not edit.
export interface TextRun { text: string; color?: string; bold?: true; dim?: true; italic?: true; underline?: true; strikethrough?: true }
export interface FormulaImage { png: string; columns: number; rows: number; tex: string; display: boolean }
export type Segment = { kind: "text"; runs: TextRun[] } | { kind: "image"; image: FormulaImage; id: number; columns: number; rows: number };
export type Row = { kind: "line"; segments: Segment[] } | { kind: "band"; left: Segment[][]; image: Extract<Segment, { kind: "image" }>; right: Segment[][] };
export type Part = { kind: "markdown"; text: string } | { kind: "rich"; rows: Row[] };
export interface MessagePlan { rich: boolean; parts: Part[] }
export interface Host { wasm(): Promise<WebAssembly.Module>; readGlyphs(name: string): Promise<unknown[]> }
export interface RenderSettings { width: number; images: boolean; mathColor: string; cellAspect?: number }
export declare const MATH_COLORS: { readonly dark: "#ffffff"; readonly light: "#000000" };
export declare function start(host: Host): Promise<boolean>;
export declare function engineStatus(): string;
export declare function renderText(text: string, settings: RenderSettings): Promise<MessagePlan>;
export declare function mightNeedCore(text: string): boolean;
export declare function formulaAlt(tex: string, display: boolean): string;
export declare function themeAppearance(theme: unknown): "dark" | "light";
export declare function visibleWidth(text: string): number;
`,
);

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`plugins/claude/lib: modules ${mb(total)}, glyphs ${mb(glyphBytes)} (${glyphFiles.length} files), resvg.wasm ${mb(statSync(join(lib, "resvg.wasm")).size)}`);
