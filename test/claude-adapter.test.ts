/**
 * The Claude Code adapter's host-neutral half (src/claude), run in Node with
 * pi's math backend. The mod itself is tested inside Claude Code's sandbox by
 * plugins/claude/hooks/render.test.tsx (`claude plugin test plugins/claude`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hyperlink as piHyperlink, visibleWidth } from "@earendil-works/pi-tui";
import "../src/pi/math-backend.ts";
import { loadMathJaxSync } from "../src/core/math/mathjax.ts";
import { hyperlink } from "../src/core/text.ts";
import { layoutLines, type Row, type Segment, segmentText } from "../src/claude/layout.ts";
import { createElementMathRenderer, isMark } from "../src/claude/math.ts";
import { planMessage, type Part } from "../src/claude/message.ts";
import { claudeStyle } from "../src/claude/style.ts";

loadMathJaxSync();

const REPLY = [
	"下面是一个对比：",
	"",
	"| 方法 | 复杂度 | 说明 |",
	"| --- | --- | --- |",
	"| 快速排序 | $O(n \\log n)$ | 平均情况最快 |",
	"| 冒泡排序 | $O(n^2)$ | 简单但慢 |",
	"",
	"其中 $\\alpha + \\beta = \\gamma$，独立公式：",
	"",
	"$$",
	"\\int_0^1 x^2\\,dx = \\frac{1}{3}",
	"$$",
	"",
	"```python",
	"print(\"hi\")",
	"```",
].join("\n");

const plan = (text: string, images = true, width = 70) =>
	planMessage(text, { width, mathColor: "#ffffff", math: createElementMathRenderer({ images: () => images, color: () => "#ffffff" }) });

const rich = (parts: Part[]) => parts.filter((p): p is Extract<Part, { kind: "rich" }> => p.kind === "rich").flatMap((p) => p.rows);
const segmentWidth = (s: Segment) => (s.kind === "image" ? s.columns : visibleWidth(segmentText([s])));
const rowWidth = (r: Row) => (r.kind === "line" ? r.segments.reduce((w, s) => w + segmentWidth(s), 0) : -1);
const images = (rows: Row[]) => rows.flatMap((r) => (r.kind === "band" ? [r.image] : r.segments.filter((s) => s.kind === "image")));

test("claude: only blocks with math or tables are rendered; the rest is handed back verbatim", async () => {
	const result = await plan(REPLY);
	assert.equal(result.rich, true);
	assert.deepEqual(result.parts.map((p) => p.kind), ["markdown", "rich", "markdown"]);
	const markdown = result.parts.filter((p) => p.kind === "markdown").map((p) => (p as { text: string }).text);
	assert.deepEqual(markdown, ["下面是一个对比：", "```python\nprint(\"hi\")\n```"]);
	for (const text of markdown) assert.ok(REPLY.includes(text));
});

test("claude: plain replies are left to the host", async () => {
	for (const text of ["Just **words** and `code`.", "It costs $5 and $10.", "a | b without a table"]) {
		const result = await plan(text);
		assert.equal(result.rich, false, text);
		assert.deepEqual(result.parts, [{ kind: "markdown", text }]);
	}
});

test("claude: the CJK table's rows line up, formulas in cells included", async () => {
	const rows = rich((await plan(REPLY)).parts);
	const table = rows.filter((r) => r.kind === "line" && /[│╭╰├]/.test(segmentText(r.segments)));
	assert.equal(table.length, 6);
	const widths = new Set(table.map(rowWidth));
	assert.equal(widths.size, 1, `table rows differ in width: ${[...widths]}`);
	const cells = table.flatMap((r) => (r.kind === "line" ? r.segments.filter((s) => s.kind === "image") : []));
	assert.equal(cells.length, 2);
});

test("claude: a display formula is one multi-row picture; inline formulas are one row", async () => {
	const rows = rich((await plan(REPLY)).parts);
	const bands = rows.filter((r) => r.kind === "band");
	assert.equal(bands.length, 1);
	const band = bands[0] as Extract<Row, { kind: "band" }>;
	assert.ok(band.image.rows >= 2);
	assert.equal(band.left.length, band.image.rows);
	assert.ok(band.image.image.display);
	const inline = images(rows).filter((s) => !s.image.display);
	assert.equal(inline.length, 3);
	for (const s of inline) assert.equal(s.rows, 1);
	for (const s of images(rows)) assert.ok(Buffer.from(s.image.png, "base64").subarray(1, 4).toString() === "PNG");
});

test("claude: without pictures, formulas fall back to readable text and no markers are left", async () => {
	const rows = rich((await plan(REPLY, false)).parts);
	assert.equal(images(rows).length, 0);
	const text = rows.map((r) => (r.kind === "line" ? segmentText(r.segments) : "")).join("\n");
	assert.match(text, /α \+ β = γ/);
	assert.match(text, /O\(n log n\)/);
	assert.ok(![...text].some((ch) => isMark(ch.codePointAt(0)!)));
});

test("claude: narrow widths keep every row within the width", async () => {
	for (const width of [24, 40]) {
		const rows = rich((await plan(REPLY, true, width)).parts);
		for (const row of rows) if (row.kind === "line") assert.ok(rowWidth(row) <= width, `${rowWidth(row)} > ${width}: ${segmentText(row.segments)}`);
	}
});

test("claude: styles become props, theme colors become theme keys", () => {
	const style = claudeStyle("#ffffff");
	const line = `${style.bold(style.fg("mdHeading", "Title"))} ${style.fg("mdCode", "x")} ${style.fg("dim", "d")} ${hyperlink(style.underline("link"), "https://a.b")}`;
	const [row] = layoutLines([line], { images: new Map(), marks: new Map() });
	assert.equal(row!.kind, "line");
	const runs = (row as Extract<Row, { kind: "line" }>).segments.flatMap((s) => (s.kind === "text" ? s.runs : []));
	assert.deepEqual(runs, [
		{ text: "Title", color: "claude", bold: true },
		{ text: " " },
		{ text: "x", color: "permission" },
		{ text: " " },
		{ text: "d", dim: true },
		{ text: " " },
		{ text: "link", underline: true },
	]);
});

test("core: the hyperlink helper emits what pi-tui emits", () => {
	assert.equal(hyperlink("label", "https://example.com"), piHyperlink("label", "https://example.com"));
});
