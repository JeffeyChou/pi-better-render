/**
 * Render a Markdown file in the current terminal, outside pi.
 *
 *   npm run preview -- test/fixtures/perceptron.md [--width 90] [--plain] [--stream]
 *
 * Uses pi's dark theme colors. In Ghostty/kitty, formulas show as images.
 * --stream replays the file in small chunks to exercise the streaming path.
 */
import { readFileSync } from "node:fs";
import { setCellDimensions } from "@earendil-works/pi-tui";
import { createMathRenderer } from "../src/math/formula.ts";
import { loadMathJaxSync } from "../src/math/mathjax.ts";
import { noMath } from "../src/render/context.ts";
import { renderMarkdown } from "../src/render/rich-markdown.ts";
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
const lines = renderMarkdown(source, width, { style, math, streaming: false });
process.stdout.write(lines.join("\n") + "\n");
