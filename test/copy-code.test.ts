import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { noMath } from "../src/render/context.ts";
import { codeButtonText, codeButtonWidth } from "../src/render/code-action.ts";
import { RichMarkdown } from "../src/render/rich-markdown.ts";
import { plainStyle } from "../src/style.ts";

const base = { style: plainStyle(), math: noMath, streaming: false, paddingX: 1 };
const event = (type: TuiMouseEvent["type"], x: number, y: number): TuiMouseEvent => ({
	type, button: "left", x, y, screenX: x, screenY: y, width: 60, height: 100,
	shift: false, alt: false, ctrl: false,
});
function buttons(lines: string[]) {
	return lines.flatMap((line, y) => {
		const index = line.indexOf(codeButtonText("idle"));
		return index < 0 ? [] : [{ x: visibleWidth(line.slice(0, index)), y }];
	});
}
async function click(component: RichMarkdown, x: number, y: number) {
	assert.equal(component.handleMouse(event("press", x, y))?.capture, true);
	assert.equal(component.handleMouse(event("release", x, y))?.handled, true);
	await Promise.resolve();
}

test("all button states fit the same measured hit region", () => {
	for (const status of ["idle", "success"] as const) {
		assert.equal(visibleWidth(codeButtonText(status)), codeButtonWidth);
	}
	const copyCode = async () => {};
	for (const width of [12, 16, 24, 80]) {
		const lines = new RichMarkdown("```long-language-name\nx\n```", { ...base, copyCode }).render(width);
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
		const hits = buttons(lines);
		for (const hit of hits) assert.ok(hit.x + codeButtonWidth <= width);
		if (width === 12) assert.equal(hits.length, 1, "compact button fits without the language label");
	}
});

test("copy original source at the visible button, including nested blocks and cached layouts", async () => {
	const source = "Intro\n\n```sh\n\techo hello\n```\n\n> ```py\n> print('好')\n> ```\n\n- Item\n\n  ```js\n  const value = 3;\n  ```";
	for (const width of [60, 28, 80, 60]) {
		const copied: string[] = [];
		const component = new RichMarkdown(source, { ...base, copyCode: async (code) => { copied.push(code); } });
		const hits = buttons(component.render(width));
		assert.equal(hits.length, 3);
		for (const hit of hits) await click(component, hit.x, hit.y);
		assert.deepEqual(copied, ["\techo hello", "print('好')", "const value = 3;"]);
		assert.ok(component.render(width).some((line) => line.includes(codeButtonText("success"))));
	}
});

test("resize updates hit regions; body selection, wheel and cancelled drags do not copy", async () => {
	let copies = 0;
	const component = new RichMarkdown("```sh\necho " + "long ".repeat(30) + "\n```", { ...base, copyCode: async () => { copies++; } });
	component.render(80);
	const [hit] = buttons(component.render(30));
	assert.ok(hit);
	assert.equal(component.handleMouse(event("press", 2, hit.y + 1)), undefined);
	assert.equal(component.handleMouse(event("wheel", hit.x, hit.y)), undefined);
	component.handleMouse(event("press", hit.x, hit.y));
	component.handleMouse(event("drag", 2, hit.y + 1));
	component.handleMouse(event("release", hit.x, hit.y));
	assert.equal(copies, 0);
	await click(component, hit.x, hit.y);
	assert.equal(copies, 1);
});

test("pending clipboard operation keeps Copy visible and ignores repeated clicks", async () => {
	let finish!: () => void;
	let copies = 0;
	const pending = new Promise<void>((resolve) => { finish = resolve; });
	const component = new RichMarkdown("```sh\nx\n```", { ...base, copyCode: async () => { copies++; await pending; } });
	const [hit] = buttons(component.render(60));
	await click(component, hit!.x, hit!.y);
	await click(component, hit!.x, hit!.y);
	assert.equal(copies, 1);
	assert.ok(component.render(60).some((line) => line.includes(codeButtonText("idle"))));
	finish();
	await pending;
	await Promise.resolve();
	assert.ok(component.render(60).some((line) => line.includes(codeButtonText("success"))));
});

test("regular mode and open fences have no button; clipboard failure is not reported as success", async () => {
	assert.equal(buttons(new RichMarkdown("```sh\nx\n```", base).render(60)).length, 0);
	const copyCode = async () => { throw new Error("clipboard unavailable"); };
	assert.equal(buttons(new RichMarkdown("```sh\nx", { ...base, streaming: true, copyCode }).render(60)).length, 0);
	let failure: unknown;
	const component = new RichMarkdown("```sh\nx\n```", { ...base, copyCode, onCopyError: (error) => { failure = error; } });
	const [hit] = buttons(component.render(60));
	await click(component, hit!.x, hit!.y);
	assert.ok(failure instanceof Error);
	assert.ok(component.render(60).some((line) => line.includes(codeButtonText("idle"))));
	assert.ok(!component.render(60).some((line) => line.includes(codeButtonText("success"))));
});
