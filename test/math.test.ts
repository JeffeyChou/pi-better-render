import assert from "node:assert/strict";
import { test } from "node:test";
import { setCapabilities, setCellDimensions, visibleWidth } from "@earendil-works/pi-tui";
import { createMathRenderer } from "../src/math/formula.ts";
import { deleteImages, installFrameHook, placeholderRows, prepareFrame, registerImage, setKittyWriter, transmitSequence } from "../src/math/kitty.ts";
import { loadMathJaxSync, MathError, rasterize } from "../src/math/mathjax.ts";
import { renderMarkdown } from "../src/render/rich-markdown.ts";
import { containsRenderArtifacts, sanitizeMessages, stripRenderArtifacts } from "../src/sanitize.ts";
import { plainStyle } from "../src/style.ts";
import { state } from "../src/state.ts";

loadMathJaxSync();
const cell = { cellWidth: 9, cellHeight: 18 };
const base = { color: "#d4d4d4", maxColumns: 80, ...cell };

function pngSize(base64: string): { w: number; h: number } {
	const buf = Buffer.from(base64, "base64");
	assert.equal(buf.subarray(1, 4).toString(), "PNG");
	return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test("MathJax renders AMS constructs to PNG on the cell grid", () => {
	for (const tex of ["\\boxed{b=-\\theta}", "y=\\begin{cases}1&z>0\\\\0&z\\le 0\\end{cases}", "\\begin{aligned}a&=b\\\\c&=d\\end{aligned}", "\\frac{x-\\mu}{\\sigma}"]) {
		const r = rasterize({ ...base, tex, display: true, maxRows: 24 });
		const { w, h } = pngSize(r.base64);
		assert.equal(w, r.columns * 9 * 2, tex);
		assert.equal(h, r.rows * 18 * 2, tex);
	}
});

test("MathJax 4 packages, font extensions, extra macros and single tags typeset", () => {
	for (const tex of ["\\dv{f}{x}+\\pdv{f}{y}+\\norm{v}", "\\ce{2H2 + O2 -> 2H2O}", "\\mathbbm{1}\\mathds{1}", "\\bm{x}\\llbracket A\\rrbracket", "\\qty{3}{m}", "E=mc^2\\tag{1}", "\\text{中文} x"]) {
		assert.doesNotThrow(() => rasterize({ ...base, tex, display: true, maxRows: 24 }), tex);
	}
});

test("inline formulas fit in exactly one row", () => {
	const r = rasterize({ ...base, tex: "\\sum_{i=1}^{n} x_i^2", display: false, maxRows: 1, fitRows: true });
	assert.equal(r.rows, 1);
});

test("inline formulas stay one image (no MathJax 4 inline line breaking)", () => {
	const r = rasterize({ ...base, tex: "z=w_1x_1+w_2x_2-\\theta", display: false, maxRows: 1, fitRows: true });
	assert.ok(r.columns > 10, `only ${r.columns} columns`);
});

test("TeX errors surface as MathError", () => {
	assert.throws(() => rasterize({ ...base, tex: "\\frac{a", display: true, maxRows: 24 }), MathError);
	assert.throws(() => rasterize({ ...base, tex: "\\undefinedmacro{x}", display: true, maxRows: 24 }), MathError);
});

test("rasterizing is fast (~ms per formula)", () => {
	const started = performance.now();
	for (let i = 0; i < 50; i++) rasterize({ ...base, tex: `x_{${i}}=\\frac{${i}}{\\sqrt{${i}+1}}`, display: true, maxRows: 24 });
	const perFormula = (performance.now() - started) / 50;
	assert.ok(perFormula < 20, `${perFormula.toFixed(2)} ms per formula`);
});

test("placeholders are one column per cell and transmit once", () => {
	const rows = placeholderRows(0x123456, 7, 2);
	assert.equal(rows.length, 2);
	assert.ok(rows.every((r) => visibleWidth(r) === 7));
	assert.ok(rows[0]!.startsWith("\x1b[38;2;18;52;86m"));
	const seq = transmitSequence("A".repeat(9000), 5, 3, 1);
	assert.equal(seq.match(/\x1b_G/g)!.length, 3);
	assert.ok(seq.startsWith("\x1b_Ga=T,f=100,q=2,U=1,i=5,c=3,r=1,m=1;"));
	assert.ok(!rows.join("").includes("\x1b[58"), "no SGR 58: pi-tui mis-parses it into bogus attributes");
});

test("end to end: formulas become placeholders, transmitted once, width respected", () => {
	const writes: string[] = [];
	setKittyWriter((d) => writes.push(d));
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	setCellDimensions({ widthPx: 9, heightPx: 18 });
	process.env.PI_BETTER_RENDER_PLACEHOLDERS = "1";
	const math = createMathRenderer(() => "#d4d4d4");
	const md = "Inline $a^2+b^2=c^2$ here.\n\n\\[\n\\boxed{b=-\\theta}\n\\]\n";
	const lines = renderMarkdown(md, 60, { style: plainStyle(), math, streaming: false });
	const text = lines.join("\n");
	assert.ok(text.includes("\u{10EEEE}"));
	assert.ok(lines.every((l) => visibleWidth(l) <= 60));
	const transmits = writes.join("").match(/\x1b_Ga=T/g)?.length;
	assert.equal(transmits, 2);
	renderMarkdown(md + "\nmore", 60, { style: plainStyle(), math, streaming: false });
	assert.equal(writes.join("").match(/\x1b_Ga=T/g)?.length, 2, "cached formulas are not re-sent");

	state.math = "final";
	const streaming = renderMarkdown(md, 60, { style: plainStyle(), math, streaming: true }).join("\n");
	assert.ok(!streaming.includes("\u{10EEEE}"), "math:final keeps text while streaming");
	state.math = "streaming";
	setKittyWriter(undefined);
});

test("sanitizer strips image artifacts and leaves clean text alone", () => {
	const rendered = `x ${placeholderRows(0x10abcd, 4, 1)[0]} y${transmitSequence("QUJD", 7, 1, 1)}`;
	assert.ok(containsRenderArtifacts(rendered));
	assert.equal(stripRenderArtifacts(rendered), "x  y");

	const clean = [
		{ role: "user", content: "what is $x^2$?" },
		{ role: "assistant", content: [{ type: "text", text: "It is \\(x^2\\)." }] },
	];
	assert.equal(sanitizeMessages(clean), undefined);

	const dirty = [
		{ role: "assistant", content: [{ type: "text", text: `a${rendered}` }] },
		{ role: "toolResult", content: [{ type: "text", text: "\x1b_Gkeep" }] },
	];
	const result = sanitizeMessages(dirty)!;
	assert.equal(result.cleaned, 1);
	assert.equal((result.messages[0]!.content as any)[0].text, "ax  y");
	assert.equal(result.messages[1], dirty[1], "tool results are untouched");
	assert.notEqual(result.messages[0], dirty[0], "input messages are not mutated");
	assert.ok(containsRenderArtifacts((dirty[0]!.content as any)[0].text));
});

test("frame hook: images travel with frames and are re-sent after a full clear", () => {
	deleteImages(undefined);
	const written: string[] = [];
	const terminal = { write: (d: string) => void written.push(d) };
	const uninstall = installFrameHook(terminal);
	const line = `a ${placeholderRows(0x112233, 3, 1)[0]} b`;
	registerImage(0x112233, "QUJD", 3, 1);
	assert.equal(written.length, 0, "no direct write while hooked");

	terminal.write(`\x1b[?2026h${line}\x1b[?2026l`);
	assert.equal(written[0]!.split("\x1b_Ga=T").length - 1, 1);
	assert.ok(written[0]!.indexOf("\x1b_Ga=T") < written[0]!.indexOf("\u{10EEEE}"), "image precedes its placeholders");

	terminal.write(`\r\n${line}`);
	assert.ok(!written[1]!.includes("\x1b_Ga=T"), "already sent");

	// pi's resize path: clear screen + scrollback, then redraw everything.
	terminal.write(`\x1b[2J\x1b[H\x1b[3J${line}`);
	const frame = written[2]!;
	assert.ok(frame.indexOf("\x1b[3J") < frame.indexOf("\x1b_Ga=T"), "re-sent after the clear");

	// A styled prefix (heading color) right before the image must not be taken for its id.
	deleteImages(undefined);
	registerImage(0x112233, "QUJD", 3, 1);
	const styled = prepareFrame(`\x1b[38;2;240;198;116m\x1b[1m${placeholderRows(0x112233, 3, 1)[0]}`);
	assert.ok(styled.transmissions.includes("i=1122867,"), "sends the image, not the heading color");

	// Color sequence split across two writes.
	terminal.write("\x1b[2J" + line.slice(0, 8));
	terminal.write(line.slice(8));
	assert.ok(written.slice(3).join("").includes("\x1b_Ga=T"));
	uninstall();
	deleteImages(undefined);
	assert.deepEqual(prepareFrame(line), { insertAt: 0, transmissions: "" }, "forgotten after deleteImages");
});
