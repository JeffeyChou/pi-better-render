import assert from "node:assert/strict";
import { test } from "node:test";
import {
	Container, Input, ScrollView, Spacer, Text, TuiAltScreen, VStack,
	visibleWidth, type Terminal,
} from "@earendil-works/pi-tui";
import { codeButtonText } from "../src/render/code-action.ts";
import { noMath } from "../src/render/context.ts";
import { RichMarkdown } from "../src/render/rich-markdown.ts";
import { plainStyle } from "../src/style.ts";

class FakeTerminal implements Terminal {
	columns = 60;
	rows = 12;
	kittyProtocolActive = false;
	writes: string[] = [];
	private input?: (data: string) => void;
	private resize?: () => void;

	start(onInput: (data: string) => void, onResize: () => void) {
		this.input = onInput;
		this.resize = onResize;
	}
	stop() { this.input = undefined; this.resize = undefined; }
	async drainInput() {}
	write(data: string) { this.writes.push(data); }
	send(data: string) {
		assert.ok(this.input, "terminal must be started");
		this.input(data);
	}
	setColumns(columns: number) { this.columns = columns; this.resize?.(); }
	moveBy(_lines: number) {}
	hideCursor() {}
	showCursor() {}
	clearLine() {}
	clearFromCursor() {}
	clearScreen() {}
	setTitle(_title: string) {}
	setProgress(_active: boolean) {}
	setProgramStatus(_status: unknown) {}
}

// Pi 0.86.1 has no public screen snapshot accessor. Inspect the committed
// frame only in this test; event routing still goes through terminal input.
function screenLines(tui: TuiAltScreen): string[] {
	return (tui as unknown as { previousScreen: string[] }).previousScreen;
}

test("host routes scrolled, resized code-button clicks without stealing editor focus", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const terminal = new FakeTerminal();
	const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true, copyOnSelect: false });
	const copied: string[] = [];
	const markdown = new RichMarkdown("> ```sh\n> \techo hello\n> ```", {
		style: plainStyle(), math: noMath, streaming: false, paddingX: 1,
		copyCode: async (code) => { copied.push(code); },
		requestRender: () => tui.requestRender(),
	});
	const transcript = new Container();
	transcript.addChild(new Spacer(20));
	const message = new Container();
	message.addChild(new Spacer(1));
	message.addChild(markdown);
	transcript.addChild(message);
	transcript.addChild(new Spacer(20));
	const scroll = new ScrollView(transcript, { primary: true, follow: "none", scrollbar: "hidden" });
	const editor = new Input();
	tui.setLayoutRoot(new VStack([
		{ component: new Text("Header", 0, 0), basis: 1 },
		{ component: scroll, basis: 0, grow: 1 },
		{ component: editor, basis: 1 },
	]));
	tui.setFocus(editor);
	try {
		tui.start();
		tui.renderNow();
		scroll.scrollTo(19);
		tui.renderNow();
		assert.equal(scroll.scrollTop, 19);
		for (const width of [60, 32]) {
			terminal.setColumns(width);
			tui.renderNow();
			const screen = screenLines(tui);
			const label = codeButtonText("idle");
			const y = screen.findIndex((line) => line.includes(label));
			assert.ok(y >= 0 && y < terminal.rows - 1);
			const line = screen[y]!;
			const x = visibleWidth(line.slice(0, line.indexOf(label)));
			assert.ok(terminal.writes.some((write) => write.includes(label)));
			const before = copied.length;
			terminal.send(`\x1b[<0;${x + 1};${y + 1}M`);
			assert.equal(copied.length, before);
			assert.equal(tui.getFocusedComponent(), editor);
			terminal.send(`\x1b[<0;${x + 1};${y + 1}m`);
			await Promise.resolve();
			tui.renderNow();
			assert.equal(copied.length, before + 1, "release + synthesized click must copy only once");
			assert.equal(copied.at(-1), "\techo hello");
			assert.ok(screenLines(tui).some((line) => line.includes(codeButtonText("success"))));
			assert.equal(tui.getFocusedComponent(), editor);
			assert.equal(tui.hasActiveSelection(), false);
			t.mock.timers.tick(1800);
			tui.renderNow();
			assert.ok(screenLines(tui).some((line) => line.includes(label)));
		}
		terminal.send("z");
		assert.equal(editor.getValue(), "z");
	} finally {
		tui.stop({ preserveScreen: true });
	}
});
