import assert from "node:assert/strict";
import { before, test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fenceClosed } from "../src/render/code.ts";
import { noMath } from "../src/render/context.ts";
import { loadMermaid } from "../src/render/mermaid.ts";
import { renderMarkdown } from "../src/render/rich-markdown.ts";
import { state } from "../src/state.ts";
import { createStyle, plainStyle } from "../src/style.ts";
import { darkTheme } from "./theme.ts";

const render = (md: string, width = 80, streaming = false) => renderMarkdown(md, width, { style: plainStyle(), math: noMath, streaming });
const fence = (body: string) => "```mermaid\n" + body + "\n```";
const FLOW = fence("graph TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Done]\n  B -->|no| A");

before(async () => {
	assert.equal(await loadMermaid(), true);
});

test("mermaid: flowchart becomes a box-drawing diagram", () => {
	const lines = render(FLOW, 60);
	const text = lines.join("\n");
	assert.ok(!text.includes("graph TD"), "source must not be shown");
	for (const label of ["Start", "OK?", "Done", "yes", "no"]) assert.ok(text.includes(label), label);
	assert.match(text, /┌─+┐/);
	assert.match(text, /[▲▼►◄]/);
	for (const line of lines) assert.ok(visibleWidth(line) <= 60, line);
});

test("mermaid: sequence, state, class and ER diagrams render", () => {
	const cases = [
		"sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello",
		"stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy\n  Busy --> [*]",
		"classDiagram\n  Animal <|-- Duck\n  Animal : +int age",
		"erDiagram\n  CUSTOMER ||--o{ ORDER : places",
	];
	for (const body of cases) {
		const text = render(fence(body)).join("\n");
		assert.ok(!text.includes(body.split("\n")[0]!), `diagram for ${body.split("\n")[0]}`);
		assert.match(text, /[┌╭●]/);
	}
});

test("mermaid: CJK labels keep box borders aligned", () => {
	const lines = render(fence("graph TD\n  A[收到请求] --> B[返回数据]"), 60);
	const top = lines.find((l) => l.includes("┌"))!;
	const label = lines.find((l) => l.includes("收到请求"))!;
	assert.equal(visibleWidth(label), visibleWidth(top));
	assert.equal(label.trimEnd().at(-1), "│");
	assert.ok(!/[-]/.test(lines.join("")), "no leftover placeholders");
});

test("mermaid: unsupported or invalid source falls back to the code block", () => {
	const pie = render(fence('pie title Pets\n  "Dogs" : 386')).join("\n");
	assert.ok(pie.includes("pie title Pets"));
	assert.ok(pie.includes("mermaid"), "language label");
	const broken = render(fence("this is not mermaid")).join("\n");
	assert.ok(broken.includes("this is not mermaid"));
});

test("mermaid: too narrow for the diagram falls back to code", () => {
	const text = render(fence("graph LR\n  A[Alpha] --> B[Beta] --> C[Gamma] --> D[Delta]"), 20).join("\n");
	assert.ok(text.includes("graph LR"));
});

test("mermaid: an open fence while streaming shows source, a closed one the diagram", () => {
	const open = render("```mermaid\ngraph TD\n  A --> B", 60, true).join("\n");
	assert.ok(open.includes("graph TD"));
	const closed = render(FLOW, 60, true).join("\n");
	assert.ok(!closed.includes("graph TD"));
	assert.ok(closed.includes("Start"));
});

test("mermaid: can be switched off", () => {
	state.mermaid = false;
	try {
		assert.ok(render(FLOW).join("\n").includes("graph TD"));
	} finally {
		state.mermaid = true;
	}
	assert.ok(!render(FLOW).join("\n").includes("graph TD"));
});

test("mermaid: themed output colors borders and arrows without breaking widths", () => {
	const style = createStyle(darkTheme(), () => undefined);
	const lines = renderMarkdown(FLOW, 60, { style, math: noMath, streaming: false });
	const plain = render(FLOW, 60);
	assert.equal(lines.length, plain.length);
	lines.forEach((line, i) => assert.equal(visibleWidth(line), visibleWidth(plain[i]!)));
	assert.ok(lines.join("").includes("\x1b[38;2;"));
});

test("mermaid: other code blocks are untouched", () => {
	assert.ok(render("```ts\ngraph TD\n```").join("\n").includes("graph TD"));
});

test("fenceClosed", () => {
	assert.equal(fenceClosed("```mermaid\ngraph TD\n```"), true);
	assert.equal(fenceClosed("```mermaid\ngraph TD\n```\n"), true);
	assert.equal(fenceClosed("````mermaid\na\n```"), false);
	assert.equal(fenceClosed("```mermaid\ngraph TD\n  A --> B"), false);
	assert.equal(fenceClosed("```mermaid\ngraph TD\n``"), false);
	assert.equal(fenceClosed("~~~mermaid\na\n~~~"), true);
});
