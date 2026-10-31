import assert from "node:assert/strict";
import { test } from "node:test";
import { setCapabilities, setCellDimensions, stripTerminalSequences } from "@earendil-works/pi-tui";
import { installCopyHook, rememberFormulaSource, selectionWithFormulas, type SelectionHost } from "../src/math/copy.ts";
import { createMathRenderer } from "../src/math/formula.ts";
import { placeholderRows, setKittyWriter } from "../src/math/kitty.ts";
import { loadMathJaxSync } from "../src/math/mathjax.ts";
import { renderMarkdown } from "../src/render/rich-markdown.ts";
import { plainStyle } from "../src/style.ts";

const DISPLAY = 0x300001;
const INLINE = 0x300002;
const UNKNOWN = 0x3000ff;
rememberFormulaSource(DISPLAY, "$$\nL = \\sum_{\\ell=4}^{9} C_\\ell^2,\n$$", true);
rememberFormulaSource(INLINE, "$C_\\ell^*$", false);

/** pi-like selection over `lines` (whole lines from row `from` to row `to`). */
function host(lines: string[], from = 0, to = lines.length - 1, startCol = 0): SelectionHost {
	const selection = { start: { row: from, col: startCol }, end: { row: to, col: 1000 } };
	return {
		previousScreen: lines,
		getSelectionBounds: () => selection,
		getSelectionColumns: (line, row) => ({ start: row === from ? startCol : 0, end: stripTerminalSequences(line).length + 10 }),
		// What pi copies: the selected columns, escape sequences stripped.
		getActiveSelectionText() {
			const out = [];
			for (let row = from; row <= to; row++) {
				const line = stripTerminalSequences(lines[row] ?? "");
				out.push([...line].slice(row === from ? startCol : 0).join("").trimEnd());
			}
			return out.join("\n");
		},
	};
}

test("a display formula is copied once, as its Markdown, without the centering", () => {
	const rows = placeholderRows(DISPLAY, 12, 3).map((row) => `          ${row}`);
	const lines = [" Use the objective:", "", ...rows, "", " Done."];
	assert.equal(selectionWithFormulas(lines), " Use the objective:\n\n$$\nL = \\sum_{\\ell=4}^{9} C_\\ell^2,\n$$\n\n Done.");
});

test("inline formulas are copied in place, also when they wrap onto the next line", () => {
	const [cells] = placeholderRows(INLINE, 6, 1);
	const open = cells!.slice(0, cells!.indexOf("\u{10EEEE}"));
	const all = [...cells!.slice(open.length).matchAll(/\u{10EEEE}[^\u{10EEEE}\x1b]*/gu)].map((m) => m[0]);
	const head = `${open}${all.slice(0, 4).join("")}\x1b[39m`;
	const tail = `${open}${all.slice(4).join("")}\x1b[39m`;
	assert.equal(selectionWithFormulas([` the term ${cells} sits here`]), " the term $C_\\ell^*$ sits here");
	assert.equal(selectionWithFormulas([` the term ${head}`, `${tail} sits here`]), " the term $C_\\ell^*$\n sits here");
	// The same formula twice on one line is copied twice.
	assert.equal(selectionWithFormulas([`${cells} and ${cells}`]), "$C_\\ell^*$ and $C_\\ell^*$");
});

test("a selection starting inside a display formula still copies all of it", () => {
	const rows = placeholderRows(DISPLAY, 12, 3);
	assert.equal(selectionWithFormulas([rows[1]!, rows[2]!, "", " after"]), "$$\nL = \\sum_{\\ell=4}^{9} C_\\ell^2,\n$$\n\n after");
});

test("placeholders of unknown images are left as they are", () => {
	const [cells] = placeholderRows(UNKNOWN, 2, 1);
	assert.equal(selectionWithFormulas([`x ${cells} y`]), stripTerminalSequences(`x ${cells} y`));
});

test("the copy hook replaces formulas in pi's selection text and leaves other selections alone", () => {
	const lines = [" Use the objective:", ...placeholderRows(DISPLAY, 12, 3), ` term ${placeholderRows(INLINE, 6, 1)[0]} here`];
	const tui = host(lines);
	const original = tui.getActiveSelectionText;
	const uninstall = installCopyHook(tui);
	assert.equal(tui.getActiveSelectionText(), " Use the objective:\n$$\nL = \\sum_{\\ell=4}^{9} C_\\ell^2,\n$$\n term $C_\\ell^*$ here");
	// Plain text: pi's own result.
	const plain = host(["just text"]);
	installCopyHook(plain);
	assert.equal(plain.getActiveSelectionText(), "just text");
	// A selection pi reads differently than expected keeps pi's text.
	const odd = host(lines);
	odd.getSelectionColumns = () => ({ start: 0, end: 3 });
	installCopyHook(odd);
	assert.ok(odd.getActiveSelectionText()!.includes("\u{10EEEE}"));
	uninstall();
	assert.equal(tui.getActiveSelectionText, original);
});

test("the hook reads selections in a scroll view from its content lines", () => {
	const scrollView = {};
	const lines = [` a ${placeholderRows(INLINE, 6, 1)[0]} b`];
	const tui: SelectionHost = {
		...host(lines),
		previousScreen: ["unrelated screen line"],
		getSelectionBounds: () => ({ start: { row: 0, col: 0, scrollView }, end: { row: 0, col: 100, scrollView } }),
		currentLayout: { root: { children: [{ children: [{ scrollView, scrollContentLines: lines }] }] } },
	};
	installCopyHook(tui);
	assert.equal(tui.getActiveSelectionText(), " a $C_\\ell^*$ b");
});

test("end to end: rendered formulas copy back as the Markdown they came from", () => {
	loadMathJaxSync();
	setKittyWriter(undefined);
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	setCellDimensions({ widthPx: 9, heightPx: 18 });
	process.env.PI_BETTER_RENDER_PLACEHOLDERS = "1";
	const math = createMathRenderer(() => "#1f2328");
	const md = [
		"Use the provisional objective:",
		"",
		"$$",
		"L = L_\\text{mix} + \\sum_{\\ell=4}^{9}\\left(C_\\ell - C_\\ell^*\\right)^2,",
		"$$",
		"",
		"where \\(C_\\ell^*\\) is the target and $\\hat y = \\sigma(w^\\top x + b)$ the prediction.",
		"",
		"\\begin{align}",
		"a &= b \\\\",
		"c &= d",
		"\\end{align}",
	].join("\n");
	const lines = renderMarkdown(md, 70, { style: plainStyle(), math, streaming: false });
	assert.ok(lines.join("\n").includes("\u{10EEEE}"), "formulas are images");
	const copied = selectionWithFormulas(lines);
	assert.ok(!copied.includes("\u{10EEEE}"), copied);
	assert.ok(copied.includes("$$\nL = L_\\text{mix} + \\sum_{\\ell=4}^{9}\\left(C_\\ell - C_\\ell^*\\right)^2,\n$$"), copied);
	assert.ok(copied.includes("\\(C_\\ell^*\\)"), copied);
	assert.ok(copied.includes("$\\hat y = \\sigma(w^\\top x + b)$"), copied);
	assert.ok(copied.includes("\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}"), copied);
	assert.equal(copied.split("$$").length - 1, 2, "the display formula is copied once");
});
