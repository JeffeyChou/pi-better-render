import assert from "node:assert/strict";
import { test } from "node:test";
import { setCellDimensions } from "@earendil-works/pi-tui";
import {
	createDirectRewriter,
	deleteImages,
	forgetImages,
	imageMode,
	installFrameHook,
	placeholderRows,
	prepareFrame,
	registerImage,
	setKittyWriter,
} from "../src/math/kitty.ts";

setKittyWriter(undefined);
setCellDimensions({ widthPx: 10, heightPx: 20 });

const ID = 0x112233;

/** Start from a clean slate with a frame hook installed, so registering sends nothing by itself. */
function fresh(): void {
	forgetImages();
	installFrameHook({ write() {} }, "direct");
}

test("image mode: placeholders in kitty/Ghostty, direct placements elsewhere, overrides win", () => {
	assert.equal(imageMode({ TERM_PROGRAM: "ghostty" }, true), "placeholder");
	assert.equal(imageMode({ KITTY_WINDOW_ID: "1" }, true), "placeholder");
	assert.equal(imageMode({ TERM_PROGRAM: "WezTerm", WEZTERM_PANE: "0" }, true), "direct");
	assert.equal(imageMode({ TERM_PROGRAM: "WarpTerminal" }, true), "direct");
	assert.equal(imageMode({ TERM_PROGRAM: "Apple_Terminal" }, false), "off");
	assert.equal(imageMode({ TERM_PROGRAM: "WezTerm", TMUX: "/tmp/x" }, true), "off");
	assert.equal(imageMode({ TERM_PROGRAM: "WezTerm", PI_BETTER_RENDER_PLACEHOLDERS: "1" }, true), "placeholder");
	assert.equal(imageMode({ TERM_PROGRAM: "ghostty", PI_BETTER_RENDER_PLACEHOLDERS: "0" }, true), "off");
	assert.equal(imageMode({ PI_BETTER_RENDER_IMAGES: "direct" }, false), "direct");
	assert.equal(imageMode({ TERM_PROGRAM: "ghostty", PI_BETTER_RENDER_IMAGES: "off" }, true), "off");
});

test("placeholder mode: placements are restored after Kitty deletes from other writers", () => {
	deleteImages(undefined);
	registerImage(ID, "QUJD", 3, 1);
	const line = `a ${placeholderRows(ID, 3, 1)[0]} b`;
	const written: string[] = [];
	const terminal = { write: (d: string) => void written.push(d) };
	const uninstall = installFrameHook(terminal, "placeholder");
	terminal.write(line);
	assert.ok(written[0]!.includes("\x1b_Ga=T"), "first sight transmits");

	// pi-tui's fullscreen mode: delete all placements (data kept), no screen clear.
	terminal.write(`\x1b_Ga=d,d=a,q=2\x1b\\${line}`);
	assert.ok(!written[1]!.includes("\x1b_Ga=T"), "data is still there");
	const place = written[1]!.indexOf("\x1b_Ga=p,q=2,U=1,i=1122867,p=1,c=3,r=1");
	assert.ok(place > written[1]!.indexOf("d=a"), "re-placed after the delete");

	// Deleting all images (fullscreen exit) or ours by id frees the data: transmit again.
	terminal.write(`\x1b_Ga=d,d=A,q=2\x1b\\${line}`);
	assert.ok(written[2]!.includes("\x1b_Ga=T"));
	terminal.write(`\x1b_Ga=d,d=I,i=${ID},q=2\x1b\\${line}`);
	assert.ok(written[3]!.includes("\x1b_Ga=T"));

	// pi deleting one of its own images leaves ours alone.
	terminal.write(`\x1b_Ga=d,d=I,i=42,q=2\x1b\\${line}`);
	assert.equal(written[4], `\x1b_Ga=d,d=I,i=42,q=2\x1b\\${line}`);
	uninstall();
});

test("session end forgets images without deleting them from the terminal", () => {
	const writes: string[] = [];
	setKittyWriter((d) => writes.push(d));
	registerImage(ID + 1, "QUJD", 3, 1);
	writes.length = 0;
	forgetImages();
	assert.deepEqual(writes, [], "nothing written: scrollback keeps its formulas");
	assert.deepEqual(prepareFrame(placeholderRows(ID + 1, 3, 1)[0]!), { insertAt: 0, transmissions: "" });
	setKittyWriter(undefined);
});

interface Placement {
	x: number;
	y: number;
	w: number;
	h: number;
	c: number;
}

function placements(out: string): Placement[] {
	return [...out.matchAll(/\x1b_Ga=p,([^;\x1b]*)\x1b\\/g)].map((m) => {
		const keys = Object.fromEntries(m[1]!.split(",").map((kv) => kv.split("=")));
		return { x: +keys.x, y: +keys.y, w: +keys.w, h: +keys.h, c: +keys.c };
	});
}

test("direct mode: placeholder runs become image slices placed at the cursor", () => {
	fresh();
	registerImage(ID, "QUJD", 3, 2); // 30×40 px fallback size (10×20 px cells)
	const [row0, row1] = placeholderRows(ID, 3, 2);
	const frame = `\x1b[2Ka ${row0} b\r\n\x1b[2K${row1}\x1b[0m`;
	const out = createDirectRewriter()(frame);
	assert.ok(!out.includes("\u{10EEEE}"), "no placeholder reaches the terminal");
	assert.equal(out.split("\x1b_Ga=t").length - 1, 1, "transmitted once");
	assert.deepEqual(placements(out), [
		{ x: 0, y: 0, w: 30, h: 20, c: 3 },
		{ x: 0, y: 20, w: 30, h: 20, c: 3 },
	]);
	assert.ok(out.includes("\x1b[3X\x1b_Ga=p"), "cells are erased, then the slice placed");
	assert.ok(out.includes("C=1"), "placing does not move the cursor");
	assert.ok(out.includes("\x1b\\\x1b[3C\x1b[39m b"), "the cursor steps over the image");

	// A partial row (e.g. a diff starting mid-image) places just that slice.
	const partial = `\x1b[38;2;17;34;51m${row1!.slice(row1!.indexOf("\u{10EEEE}")).split("\u{10EEEE}").slice(2).map((c) => "\u{10EEEE}" + c).join("")}`;
	assert.deepEqual(placements(createDirectRewriter()(partial)), [{ x: 10, y: 20, w: 20, h: 20, c: 2 }]);
});

test("direct mode: frames split anywhere still cover every cell exactly once", () => {
	const [row0, row1] = placeholderRows(ID, 3, 2);
	const frame = `\x1b[1;1H\x1b[2K\x1b[1mx ${row0}\x1b[22m y\r\n${row1}\x1b[0m`;
	for (let split = 1; split < frame.length; split++) {
		// Never split a surrogate pair (pi's writer guarantees this).
		if (frame.charCodeAt(split) >= 0xdc00 && frame.charCodeAt(split) <= 0xdfff) continue;
		fresh();
		registerImage(ID, "QUJD", 3, 2);
		const rewrite = createDirectRewriter();
		const out = rewrite(frame.slice(0, split)) + rewrite(frame.slice(split));
		assert.ok(!out.includes("\u{10EEEE}"), `split ${split}`);
		assert.equal(out.split("\x1b_Ga=t").length - 1, 1, `split ${split}`);
		for (const y of [0, 20]) {
			const slices = placements(out).filter((p) => p.y === y).sort((a, b) => a.x - b.x);
			let x = 0;
			for (const slice of slices) {
				assert.equal(slice.x, x, `split ${split}, row ${y}`);
				x += slice.w;
			}
			assert.equal(x, 30, `split ${split}, row ${y}`);
		}
		assert.ok(out.includes("x ") && out.includes(" y"), `split ${split}`);
	}
});

test("direct mode: a full clear or image delete sends the data again", () => {
	fresh();
	registerImage(ID, "QUJD", 3, 1);
	const line = placeholderRows(ID, 3, 1)[0]!;
	const rewrite = createDirectRewriter();
	assert.ok(rewrite(line).includes("\x1b_Ga=t"));
	assert.ok(!rewrite(line).includes("\x1b_Ga=t"), "already sent");
	assert.ok(rewrite(`\x1b[2J${line}`).includes("\x1b_Ga=t"));
	assert.ok(rewrite(`\x1b_Ga=d,d=A,q=2\x1b\\${line}`).includes("\x1b_Ga=t"));
	assert.ok(!rewrite(`\x1b_Ga=d,d=a,q=2\x1b\\${line}`).includes("\x1b_Ga=t"), "placements only: data kept");

	// Unknown ids (images of an earlier session) degrade to blank cells.
	const stranger = createDirectRewriter()(placeholderRows(0x200000, 2, 1)[0]!);
	assert.ok(!stranger.includes("\x1b_G") && stranger.includes("  "));
});

test("direct mode through the frame hook", () => {
	forgetImages();
	registerImage(ID, "QUJD", 3, 1);
	const written: string[] = [];
	const terminal = { write: (d: string) => void written.push(d) };
	const uninstall = installFrameHook(terminal, "direct");
	terminal.write(`a ${placeholderRows(ID, 3, 1)[0]} b`);
	assert.equal(placements(written.join("")).length, 1);
	uninstall();
});
