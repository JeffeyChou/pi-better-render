import assert from "node:assert/strict";
import { test } from "node:test";
import { noMath } from "../src/render/context.ts";
import { depsDir, loadMermaid, mermaidEngine } from "../src/render/mermaid.ts";
import { renderMarkdown } from "../src/render/rich-markdown.ts";
import { setRenderRequester, state } from "../src/state.ts";
import { plainStyle } from "../src/style.ts";

// Runs in its own process: the renderer starts out not loaded.
const FLOW = "```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```";
const render = () => renderMarkdown(FLOW, 60, { style: plainStyle(), math: noMath, streaming: false }).join("\n");

test("mermaid is loaded on first sight and the block re-renders when it arrives", async () => {
	assert.equal(mermaidEngine().state, "idle");
	let redraws = 0;
	setRenderRequester(() => redraws++);
	const version = state.version;

	const before = render();
	assert.ok(before.includes("graph TD"), "shown as code while loading");
	assert.ok(before.includes("mermaid · loading diagram renderer…"));
	assert.equal(mermaidEngine().state, "loading");

	assert.equal(await loadMermaid(), true);
	assert.equal(mermaidEngine().state, "ready");
	assert.ok(redraws > 0, "a redraw was requested");
	assert.ok(state.version > version, "render caches were invalidated");
	const after = render();
	assert.ok(!after.includes("graph TD"));
	assert.ok(after.includes("Start") && after.includes("┌"));
	setRenderRequester(undefined);
});

test("depsDir honours PI_BETTER_RENDER_DEPS_DIR", () => {
	assert.equal(depsDir({ PI_BETTER_RENDER_DEPS_DIR: "/x/deps" }), "/x/deps");
	assert.match(depsDir({}), /\.pi[\\/]agent[\\/]better-render[\\/]deps$/);
});
