import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { noMath } from "../src/render/context.ts";
import { lex } from "../src/render/lexer.ts";
import { cacheStats, clearBlockCache, renderMarkdown } from "../src/render/rich-markdown.ts";
import { fitColumns } from "../src/render/table.ts";
import { wrap } from "../src/render/util.ts";
import { placeholderRows } from "../src/math/kitty.ts";
import { createStyle, plainStyle } from "../src/style.ts";
import { darkTheme } from "./theme.ts";

const plain = { style: plainStyle(), math: noMath, streaming: false };
const render = (md: string, width = 80, streaming = false) => renderMarkdown(md, width, { ...plain, streaming });
const fixture = readFileSync(new URL("./fixtures/perceptron.md", import.meta.url), "utf8");

function types(md: string, streaming = false): string[] {
	return lex(md, streaming).filter((t) => t.type !== "space").map((t) => t.type);
}

function inlineTypes(md: string): string[] {
	const para: any = lex(md, false)[0];
	return para.tokens.map((t: any) => `${t.type}:${t.text}`);
}

test("lexer: block math delimiters", () => {
	assert.deepEqual(types("$$\na+b\n$$"), ["blockMath"]);
	assert.deepEqual(types("\\[\n\\boxed{b=-\\theta}\n\\]"), ["blockMath"]);
	assert.deepEqual(types("\\begin{align}\na&=b\\\\\nc&=d\n\\end{align}"), ["blockMath"]);
	assert.deepEqual(types("so:\n\\[\nx\n\\]\nafter"), ["paragraph", "blockMath", "paragraph"]);
});

test("lexer: math inside code is not math", () => {
	assert.deepEqual(types("```\n$$x$$\n```"), ["code"]);
	assert.deepEqual(inlineTypes("see `$x$` here"), ["text:see ", "codespan:$x$", "text: here"]);
});

test("lexer: inline math and dollar amounts", () => {
	assert.deepEqual(inlineTypes("cost $5 and $10 total"), ["text:cost $5 and $10 total"]);
	assert.deepEqual(inlineTypes("a $x^2$ b \\(y\\) c"), ["text:a ", "inlineMath:x^2", "text: b ", "inlineMath:y", "text: c"]);
	assert.deepEqual(inlineTypes("escaped \\$x$"), ["text:escaped ", "escape:$", "text:x$"]);
});

test("lexer: unclosed block math only while streaming", () => {
	const src = "text\n\n$$\n\\frac{a}{";
	const streamed: any = lex(src, true).at(-1);
	assert.equal(streamed.type, "blockMath");
	assert.equal(streamed.closed, false);
	assert.notEqual((lex(src, false).at(-1) as any).type, "blockMath");
});

test("lexer: partial closing fence is trimmed while streaming", () => {
	const token: any = lex("```py\nx = 1\n``", true)[0];
	assert.equal(token.type, "code");
	assert.equal(token.text, "x = 1");
});

test("headings drop the # markers", () => {
	const lines = render("### AND gate\n\n#### Four\n\n# One");
	assert.ok(lines.every((l) => !l.includes("#")), lines.join("\n"));
	assert.equal(lines[0], "▍ AND gate");
	assert.ok(lines.includes("━".repeat(80)));
});

test("lists use bullets, keep numbering and show tasks", () => {
	const lines = render("- a\n  - b\n    - c\n\n3. x\n4. y\n\n- [x] done\n- [ ] todo");
	assert.deepEqual(lines.slice(0, 3), ["• a", "  ◦ b", "    ▪ c"]);
	assert.ok(lines.includes("3. x") && lines.includes("4. y"));
	assert.ok(lines.includes("☑ done") && lines.includes("☐ todo"));
});

test("list continuation lines hang-indent", () => {
	const lines = render("- " + "word ".repeat(30), 40);
	assert.ok(lines.length > 1);
	assert.ok(lines.slice(1).every((l) => l.startsWith("  ")));
});

test("block quotes and callouts", () => {
	assert.deepEqual(render("> quoted"), ["▎ quoted"]);
	const callout = render("> [!WARNING]\n> Be careful");
	assert.deepEqual(callout, ["▎ ▲ Warning", "▎ Be careful"]);
});

test("code blocks have no fences and show the language", () => {
	const lines = render("```python\ndef f():\n    return 1\n```");
	assert.ok(lines.every((l) => !l.includes("```")));
	assert.ok(lines[0]!.trimEnd().endsWith("python"));
	assert.ok(lines.includes("     return 1"));
});

test("long code lines hard-wrap with a continuation mark", () => {
	const lines = render("```\n" + "x".repeat(50) + "\n```", 30);
	assert.ok(lines.some((l) => l.startsWith("↪")));
	assert.ok(lines.every((l) => visibleWidth(l) <= 30));
});

test("tables: rounded borders, alignment, CJK widths", () => {
	const lines = render("| 名称 | n |\n|:--|--:|\n| 张三 | 1 |\n| b | 22 |");
	assert.equal(lines[0], "╭──────┬────╮");
	assert.equal(lines[3], "│ 张三 │  1 │");
	assert.equal(lines[4], "│ b    │ 22 │");
	const widths = new Set(lines.map(visibleWidth));
	assert.equal(widths.size, 1);
});

test("tables shrink columns, then fall back to cards", () => {
	const md = "| a | b |\n|---|---|\n| " + "long text ".repeat(8) + "| short |";
	const lines = render(md, 40);
	assert.ok(lines.every((l) => visibleWidth(l) <= 40), lines.join("\n"));
	assert.ok(lines[0]!.startsWith("╭"));
	const cards = render("| a | b | c | d | e | f | g |\n|-|-|-|-|-|-|-|\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 |", 16);
	assert.ok(cards.every((l) => l.startsWith("▎")), cards.join("\n"));
});

test("fitColumns water-fills", () => {
	assert.deepEqual(fitColumns([5, 5], [1, 1], 20), [5, 5]);
	const fitted = fitColumns([10, 50], [5, 8], 30)!;
	assert.equal(fitted.reduce((a, b) => a + b, 0), 30);
	assert.equal(fitted[0], 10);
	assert.equal(fitColumns([5, 5, 5], [1, 1, 1], 6), undefined);
});

test("every rendered line fits the width (fixture, several widths, styled)", () => {
	const style = createStyle(darkTheme(), () => undefined);
	for (const width of [30, 50, 80, 120]) {
		for (const line of renderMarkdown(fixture, width, { style, math: noMath, streaming: false })) {
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
		}
	}
});

test("fixture regression: the issues from the screenshot", () => {
	const out = render(fixture, 90).join("\n");
	assert.ok(!/^#{1,6} /m.test(out), "no raw heading markers");
	assert.ok(out.includes("▍ AND gate"));
	assert.ok(!/^- /m.test(out), "no raw list dashes");
	assert.ok(out.includes("• a @ b: matrix multiplication"));
	assert.ok(!out.includes("```"), "no code fences");
});

test("streaming: appending text only re-renders the tail block", () => {
	clearBlockCache();
	const style = plainStyle();
	const blocks = Array.from({ length: 30 }, (_, i) => `Paragraph number ${i} with some text.`).join("\n\n");
	renderMarkdown(blocks, 80, { style, math: noMath, streaming: true });
	const before = cacheStats.misses;
	renderMarkdown(blocks + " more", 80, { style, math: noMath, streaming: true });
	assert.equal(cacheStats.misses - before, 1);
});

test("streaming render matches the final render for complete blocks", () => {
	const text = "# T\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\ntail";
	assert.deepEqual(render(text, 60, true), render(text, 60, false));
});

test("wrapping around inline images leaks no attributes into the next line", () => {
	const image = placeholderRows(0x10292a, 6, 1)[0]!; // id bytes 16;41;42 — 41 is "red background"
	const lines = wrap(`scale values from ${image}. Then more words here`, 26);
	assert.equal(lines.length, 2);
	assert.equal(lines[1], "Then more words here");
	assert.ok(lines[0]!.includes(image));
});

test("an image split by wrapping keeps its columns on both lines", () => {
	const image = placeholderRows(0x100001, 30, 1)[0]!;
	const lines = wrap(`x ${image}`, 20);
	const cells = lines.join("").match(/\u{10EEEE}\p{M}*/gu)!;
	assert.equal(cells.length, 30);
	assert.equal(cells.join(""), image.match(/\u{10EEEE}\p{M}*/gu)!.join(""), "column order preserved");
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 20);
		if (line.includes("\u{10EEEE}")) assert.ok(line.includes("\x1b[38;2;16;0;1m"), "each piece carries the image id");
	}
});

test("incremental lexing matches a full lex at every streaming step", async () => {
	const { lexStats, clearLexCache } = await import("../src/render/lexer.ts");
	const docs = [
		fixture,
		"para one\n\npara two\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSetext\n===\n\n- a\n\n  continued\n- b\n\n> q\ncontinued\n\n```js\nlet x = 1\n```\n\n$$\nx^2\n$$\n\n    indented\n\n    more\n\n[ref]: http://x\n\nend [ref]",
	];
	const strip = (tokens: any[]) => JSON.parse(JSON.stringify(tokens));
	for (const doc of docs) {
		clearLexCache();
		const before = lexStats.incremental;
		for (let i = 1; i <= doc.length; i += 5) {
			const partial = doc.slice(0, i);
			const incremental = strip(lex(partial, true)); // extends the previous step
			clearLexCache();
			const full = strip(lex(partial, true));
			assert.deepEqual(incremental, full, `diverged at ${i}: ${JSON.stringify(partial.slice(-40))}`);
			clearBlockCache();
			const a = render(partial, 70, true);
			clearBlockCache();
			assert.deepEqual(a, render(partial, 70, true));
		}
		assert.ok(lexStats.incremental > before, "incremental path was exercised");
		// Final (non-streaming) render reuses the streaming prefix and must equal a fresh lex.
		const final = strip(lex(doc, false));
		clearLexCache();
		assert.deepEqual(final, strip(lex(doc, false)));
	}
});
