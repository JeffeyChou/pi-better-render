/**
 * Render a Markdown file in the current terminal, outside pi.
 *
 *   npm run preview -- test/fixtures/perceptron.md [--width 90] [--plain] [--stream] [--live [--cps 700] [--hold 3]]
 *
 * Uses pi's dark theme colors. In Ghostty/kitty, formulas show as images.
 * --stream replays the file in small chunks to exercise the streaming path.
 * --live animates the stream on screen, following its tail like pi does
 *   (for demos and recordings): --cps characters per second, --hold seconds
 *   to keep the final frame (0 = until a key is pressed).
 */
import { readFileSync } from "node:fs";
import { setCellDimensions } from "@earendil-works/pi-tui";
import { createMathRenderer } from "../src/math/formula.ts";
import { loadMathJaxSync } from "../src/math/mathjax.ts";
import { noMath } from "../src/render/context.ts";
import { loadMermaid } from "../src/render/mermaid.ts";
import { renderMarkdown } from "../src/render/rich-markdown.ts";
import { setRenderRequester } from "../src/state.ts";
import { createStyle, plainStyle, type ThemeLike } from "../src/style.ts";
import { darkTheme } from "./theme.ts";

/** Ask the terminal for its cell size in pixels (CSI 16 t → CSI 6 ; h ; w t), like pi does. */
function queryCellSize(): Promise<RegExpExecArray | null> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(null);
	return new Promise((resolve) => {
		let buffer = "";
		const done = (value: RegExpExecArray | null) => {
			clearTimeout(timer);
			process.stdin.off("data", onData);
			process.stdin.setRawMode(false);
			process.stdin.pause();
			resolve(value);
		};
		const onData = (chunk: Buffer) => {
			buffer += chunk.toString();
			const m = /\x1b\[6;(\d+);(\d+)t/.exec(buffer);
			// Reorder to "WxH" groups.
			if (m) done(/(\d+)x(\d+)/.exec(`${m[2]}x${m[1]}`));
		};
		const timer = setTimeout(() => done(null), 300);
		process.stdin.setRawMode(true);
		process.stdin.on("data", onData);
		process.stdin.resume();
		process.stdout.write("\x1b[16t");
	});
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? "test/fixtures/perceptron.md";
const width = Number(args[args.indexOf("--width") + 1]) || Math.min(process.stdout.columns || 100, 110);
const plain = args.includes("--plain");
const stream = args.includes("--stream");
const live = args.includes("--live");
const option = (name: string, fallback: number) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback);

const theme: ThemeLike = darkTheme();
const style = plain ? plainStyle() : createStyle(theme, () => undefined);
let math = noMath;
if (!plain) {
	loadMathJaxSync();
	const cell = /(\d+)x(\d+)/.exec(process.env.CELL ?? "") ?? (await queryCellSize());
	if (cell) setCellDimensions({ widthPx: +cell[1]!, heightPx: +cell[2]! });
	console.error(`cell: ${cell ? `${cell[1]}x${cell[2]}` : "default 9x18"}`);
	math = createMathRenderer(() => style.mathColor);
}

const source = readFileSync(file, "utf8");
// Static output waits for the diagram renderer; --live shows it arriving (downloaded on first use).
if (!live && /^ {0,3}(`{3,}|~{3,})\s*mermaid/im.test(source)) await loadMermaid();
if (stream) {
	const started = performance.now();
	let frames = 0;
	for (let i = 40; i < source.length; i += 40) {
		renderMarkdown(source.slice(0, i), width, { style, math, streaming: true });
		frames++;
	}
	const ms = performance.now() - started;
	console.error(`streamed ${frames} frames, ${(ms / frames).toFixed(2)} ms/frame`);
}
if (live) {
	await playLive();
} else {
	const lines = renderMarkdown(source, width, { style, math, streaming: false });
	process.stdout.write(lines.join("\n") + "\n");
}

async function playLive(): Promise<void> {
	const out = process.stdout;
	const cps = option("--cps", 700);
	const hold = option("--hold", 3);
	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
	// Deterministic, token-like chunk sizes (4–24 characters).
	let seed = 7;
	const chunk = () => 4 + ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 21);
	let last: [string, boolean] = ["", true];
	const draw = (text: string, streaming: boolean) => {
		last = [text, streaming];
		const rows = out.rows || 40;
		const view = renderMarkdown(text, width, { style, math, streaming }).slice(-rows);
		// Synchronized output: the terminal shows each frame whole.
		out.write(`\x1b[?2026h\x1b[H${view.map((line) => `${line}\x1b[0m\x1b[K`).join("\r\n")}\x1b[J\x1b[?2026l`);
	};
	// Asynchronous work (the diagram renderer arriving) asks for a redraw, like pi's TUI.
	setRenderRequester(() => setImmediate(() => draw(...last)));
	out.write("\x1b[?1049h\x1b[?25l\x1b[2J");
	// Raw mode so stray key presses are not echoed into the recording.
	if (process.stdin.isTTY) process.stdin.setRawMode(true).resume();
	try {
		let shown = 0;
		while (shown < source.length) {
			const size = chunk();
			shown = Math.min(source.length, shown + size);
			draw(source.slice(0, shown), shown < source.length);
			await sleep((size / cps) * 1000);
		}
		draw(source, false);
		if (hold > 0) await sleep(hold * 1000);
		else await new Promise((resolve) => process.stdin.once("data", resolve));
	} finally {
		out.write("\x1b[?25h\x1b[?1049l");
		if (process.stdin.isTTY) process.stdin.setRawMode(false);
		process.stdin.pause();
	}
}
