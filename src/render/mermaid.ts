/**
 * ```mermaid blocks → Unicode box-drawing diagrams (beautiful-mermaid, in process, no DOM).
 *
 * Supported: flowchart/graph, stateDiagram, sequenceDiagram, classDiagram,
 * erDiagram. Anything else (unsupported type, syntax error, diagram wider than
 * the terminal) falls back to the ordinary code block.
 *
 * beautiful-mermaid (~11 MB with elkjs) is not a dependency: sessions without
 * diagrams never download it. The first mermaid block looks for it next to
 * this package, then in the user cache (~/.pi/agent/better-render/deps), and
 * otherwise installs the pinned version there with npm in the background.
 * Blocks show as code meanwhile and turn into diagrams once it has loaded.
 * PI_BETTER_RENDER_MERMAID_INSTALL=0 disables the download.
 *
 * beautiful-mermaid lays text out one UTF-16 unit per cell, so wide (CJK)
 * characters would misalign the boxes. Each one is swapped for two 1-column
 * placeholder characters before layout and restored afterwards.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bumpVersion, requestRender, state } from "../state.ts";
import type { RenderContext } from "./context.ts";
import { visibleWidth } from "./util.ts";

type AsciiRenderer = (text: string, options?: Record<string, unknown>) => string;

export const MERMAID_PACKAGE = "beautiful-mermaid";
export const MERMAID_VERSION = "1.1.3";
const INSTALL_TIMEOUT_MS = 180_000;

export type MermaidEngine = "idle" | "loading" | "installing" | "ready" | "unavailable";

let renderAscii: AsciiRenderer | undefined;
let loading: Promise<boolean> | undefined;
let engine: MermaidEngine = "idle";
let engineError: string | undefined;

export function mermaidEngine(): { state: MermaidEngine; error?: string } {
	return { state: engine, error: engineError };
}

/** Where downloaded renderer packages live. */
export function depsDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.PI_BETTER_RENDER_DEPS_DIR || join(homedir(), ".pi", "agent", "better-render", "deps");
}

function setEngine(next: MermaidEngine, error?: string): void {
	engine = next;
	engineError = error;
	bumpVersion();
	requestRender();
}

/** Import the package from a node_modules directory, or undefined when it is not there. */
async function importFrom(nodeModules: string): Promise<any> {
	const dir = join(nodeModules, MERMAID_PACKAGE);
	let pkg: any;
	try {
		pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
	} catch {
		return undefined;
	}
	const entry = pkg.exports?.["."]?.import ?? pkg.module ?? pkg.main ?? "dist/index.js";
	const mod = await import(pathToFileURL(join(dir, entry)).href);
	return typeof mod?.renderMermaidASCII === "function" ? mod : undefined;
}

/** node_modules directories Node would search from this file (a dev install or a user-provided copy). */
function localNodeModules(): string[] {
	try {
		return createRequire(import.meta.url).resolve.paths(MERMAID_PACKAGE) ?? [];
	} catch {
		return [];
	}
}

function npmInstall(prefix: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const windows = process.platform === "win32";
		const args = ["install", `${MERMAID_PACKAGE}@${MERMAID_VERSION}`, "--prefix", prefix, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"];
		const child = spawn(windows ? "npm.cmd" : "npm", args, { stdio: ["ignore", "ignore", "pipe"], shell: windows, windowsHide: true });
		let stderr = "";
		child.stderr?.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
		const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(stderr.trim().split("\n").pop() || `npm exited with ${code}`));
		});
	});
}

async function findOrInstall(): Promise<any> {
	for (const dir of localNodeModules()) {
		if (!existsSync(join(dir, MERMAID_PACKAGE))) continue;
		const mod = await importFrom(dir).catch(() => undefined);
		if (mod) return mod;
	}
	const prefix = depsDir();
	const cached = await importFrom(join(prefix, "node_modules")).catch(() => undefined);
	if (cached) return cached;
	if (process.env.PI_BETTER_RENDER_MERMAID_INSTALL === "0") throw new Error("not installed (download disabled)");
	setEngine("installing");
	await mkdir(prefix, { recursive: true });
	// Own package.json, so npm never walks up into an enclosing project.
	if (!existsSync(join(prefix, "package.json"))) {
		await writeFile(join(prefix, "package.json"), JSON.stringify({ name: "better-render-deps", private: true }, null, 2) + "\n");
	}
	await npmInstall(prefix);
	const installed = await importFrom(join(prefix, "node_modules"));
	if (!installed) throw new Error("installed package could not be loaded");
	return installed;
}

/** Find, download if needed, and import beautiful-mermaid (idempotent); re-renders once done. */
export function loadMermaid(): Promise<boolean> {
	loading ??= (async () => {
		engine = "loading";
		try {
			const mod = await findOrInstall();
			renderAscii = mod.renderMermaidASCII as AsciiRenderer;
			setEngine("ready");
			return true;
		} catch (error) {
			setEngine("unavailable", error instanceof Error ? error.message : String(error));
			return false;
		}
	})();
	return loading;
}

export function isMermaid(lang: string): boolean {
	return lang.toLowerCase() === "mermaid";
}

/** Airy layout first; a compact one when that does not fit the width. */
const LAYOUTS = [
	{ paddingX: 4, paddingY: 2, boxBorderPadding: 1 },
	{ paddingX: 2, paddingY: 1, boxBorderPadding: 0 },
];

const WIDE_BASE = 0xe000;
const WIDE_TAIL = "";
const WIDE_PAIR = /([-])/g;
const PRIVATE_USE = /[-]/g;

/** Replace each wide character by two 1-column placeholders; returns the table to restore them. */
function protectWide(source: string): { text: string; wide: string[] } {
	const wide: string[] = [];
	const index = new Map<string, number>();
	let text = "";
	for (const char of source) {
		if (char.charCodeAt(0) < 0x1100 || visibleWidth(char) !== 2) {
			text += char;
			continue;
		}
		let i = index.get(char);
		if (i === undefined) {
			i = wide.length;
			if (WIDE_BASE + i >= 0xf8ff) return { text: source, wide: [] };
			wide.push(char);
			index.set(char, i);
		}
		text += String.fromCharCode(WIDE_BASE + i) + WIDE_TAIL;
	}
	return { text, wide };
}

function restoreWide(text: string, wide: string[]): string {
	if (wide.length === 0) return text;
	return text.replace(WIDE_PAIR, (m, head: string) => wide[head.charCodeAt(0) - WIDE_BASE] ?? m).replace(PRIVATE_USE, " ");
}

const ARROWS = /[▲▼◄►▶◀△▽◁▷]/;
const STRUCTURE = /[─-╿◇◆●○□■]/;

/** Borders muted, arrowheads accented, labels in the text color. */
function colorize(line: string, ctx: RenderContext): string {
	const { style } = ctx;
	let out = "";
	let run = "";
	let kind = "";
	const flush = () => {
		if (!run) return;
		if (kind === "arrow") out += style.fg("accent", run);
		else if (kind === "line") out += style.fg("mdCodeBlockBorder", run);
		else out += ctx.textStyle ? ctx.textStyle(run) : run;
		run = "";
	};
	for (const char of line) {
		const k = ARROWS.test(char) ? "arrow" : STRUCTURE.test(char) ? "line" : char === " " ? kind : "text";
		if (k !== kind) {
			flush();
			kind = k;
		}
		run += char;
	}
	flush();
	return out;
}

/** Code block label suffix while the renderer is on its way. */
export function mermaidPendingNote(): string {
	if (!state.mermaid) return "";
	if (engine === "installing") return "downloading diagram renderer…";
	if (engine === "loading") return "loading diagram renderer…";
	return "";
}

/**
 * Diagram lines for a mermaid block, or undefined to render it as code
 * (disabled, library not loaded yet, unsupported/invalid source, too wide).
 */
export function renderMermaid(source: string, ctx: RenderContext): string[] | undefined {
	if (!state.mermaid) return undefined;
	if (!renderAscii) {
		void loadMermaid();
		return undefined;
	}
	const { text, wide } = protectWide(source);
	for (const layout of LAYOUTS) {
		let art: string;
		try {
			art = renderAscii(text, { colorMode: "none", ...layout });
		} catch {
			return undefined;
		}
		const lines = restoreWide(art, wide)
			.split("\n")
			.map((l) => l.replace(/\s+$/, ""));
		while (lines.length > 0 && lines[0] === "") lines.shift();
		while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
		if (lines.length === 0) return undefined;
		const widest = Math.max(...lines.map(visibleWidth));
		if (widest > ctx.width) continue;
		const left = " ".repeat(Math.floor((ctx.width - widest) / 2));
		return lines.map((l) => (l ? left + colorize(l, ctx) : ""));
	}
	return undefined;
}
