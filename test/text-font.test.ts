import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { configureTextFonts, FontPendingError, scriptsIn, textFontOptions, textFontStatus } from "../src/math/cjk-font.ts";
import { createMathRenderer } from "../src/math/formula.ts";
import { setKittyWriter } from "../src/math/kitty.ts";
import { loadMathJaxSync } from "../src/math/mathjax.ts";
import { renderMarkdown } from "../src/render/rich-markdown.ts";
import { setRenderRequester, state } from "../src/state.ts";
import { plainStyle } from "../src/style.ts";

const dir = mkdtempSync(join(tmpdir(), "better-render-fonts-"));
after(() => {
	rmSync(dir, { recursive: true, force: true });
	configureTextFonts();
});

const none = { han: [], hangul: [] };
const bytes = Buffer.from("fake font data");
const spec = (data: Buffer, file = "Fake.ttf") => ({ file, url: `https://example.invalid/${file}`, sha256: createHash("sha256").update(data).digest("hex"), bytes: data.length });
const svgWith = (text: string) => `<svg><text>${text}</text></svg>`;

/** A fetch that answers once released. */
function gatedFetch(data: Buffer) {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const calls: string[] = [];
	const fetch = async (url: string) => {
		calls.push(url);
		await gate;
		return { ok: true, status: 200, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length) as ArrayBuffer };
	};
	return { fetch, calls, release };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("scripts are detected per character class", () => {
	assert.deepEqual(scriptsIn("x + y"), []);
	assert.deepEqual(scriptsIn("中文"), ["han"]);
	assert.deepEqual(scriptsIn("かな、"), ["han"]);
	assert.deepEqual(scriptsIn("한국어 and 中文"), ["han", "hangul"]);
});

test("a system font is used when one covers the script", () => {
	const system = join(dir, "system.ttc");
	writeFileSync(system, "x");
	const { fetch, calls } = gatedFetch(bytes);
	configureTextFonts({ system: { han: [system], hangul: [] }, generic: [], dir, fetch });
	assert.deepEqual(textFontOptions(svgWith("中文")), { loadSystemFonts: false, fontFiles: [system] });
	assert.equal(calls.length, 0);
});

test("a missing font downloads once, formulas wait for it, then it is used", async () => {
	const { fetch, calls, release } = gatedFetch(bytes);
	configureTextFonts({ system: none, generic: [], dir, fetch, downloads: { han: spec(bytes), hangul: spec(bytes, "FakeKR.ttf") } });
	let redraws = 0;
	setRenderRequester(() => redraws++);
	const version = state.version;

	assert.throws(() => textFontOptions(svgWith("中文")), FontPendingError);
	assert.throws(() => textFontOptions(svgWith("汉字")), FontPendingError);
	assert.equal(calls.length, 1, "one download for many formulas");
	assert.match(textFontStatus(), /CJK: downloading/);
	// Text without CJK is not held up.
	assert.deepEqual(textFontOptions(svgWith("Привет")), { loadSystemFonts: true });

	release();
	await settle();
	assert.ok(redraws > 0 && state.version > version, "re-render requested");
	const path = join(dir, "Fake.ttf");
	assert.ok(existsSync(path));
	assert.deepEqual(textFontOptions(svgWith("中文")), { loadSystemFonts: false, fontFiles: [path] });
	assert.match(textFontStatus(), /CJK: Fake\.ttf/);

	// Later sessions find the file without downloading.
	configureTextFonts({ system: none, generic: [], dir, fetch, downloads: { han: spec(bytes), hangul: spec(bytes, "FakeKR.ttf") } });
	assert.deepEqual(textFontOptions(svgWith("中文")), { loadSystemFonts: false, fontFiles: [path] });
	assert.equal(calls.length, 1);
	setRenderRequester(undefined);
});

test("a corrupted download is rejected and not retried", async () => {
	const { fetch, calls, release } = gatedFetch(Buffer.from("tampered"));
	configureTextFonts({ system: none, generic: [], dir, fetch, downloads: { han: spec(bytes, "Other.ttf"), hangul: spec(bytes, "OtherKR.ttf") } });
	assert.throws(() => textFontOptions(svgWith("中文")), FontPendingError);
	release();
	await settle();
	assert.ok(!existsSync(join(dir, "Other.ttf")));
	assert.match(textFontStatus(), /checksum mismatch/);
	assert.deepEqual(textFontOptions(svgWith("中文")), { loadSystemFonts: true });
	assert.equal(calls.length, 1);
});

test("PI_BETTER_RENDER_FONT_DOWNLOAD=0 never downloads", () => {
	const { fetch, calls } = gatedFetch(bytes);
	configureTextFonts({ system: none, generic: [], dir, fetch, allowDownload: false, downloads: { han: spec(bytes, "No.ttf"), hangul: spec(bytes, "NoKR.ttf") } });
	assert.doesNotThrow(() => textFontOptions(svgWith("中文")));
	assert.equal(calls.length, 0);
});

// A real CJK font stands in for the download, so the formula actually rasterizes with it.
const realFont = ["/System/Library/Fonts/Hiragino Sans GB.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"].find((f) => existsSync(f));

test("end to end: a \\text{中文} formula is text while the font downloads, an image after", { skip: !realFont && "no CJK font to stand in for the download" }, async () => {
	const data = readFileSync(realFont!);
	const { fetch, release } = gatedFetch(data);
	configureTextFonts({ system: none, generic: [], dir, fetch, downloads: { han: spec(data, "Real.ttc"), hangul: spec(data, "RealKR.ttc") } });
	loadMathJaxSync();
	setKittyWriter(undefined);
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	setCellDimensions({ widthPx: 9, heightPx: 18 });
	process.env.PI_BETTER_RENDER_PLACEHOLDERS = "1";
	const math = createMathRenderer(() => "#d4d4d4");
	const md = "\\[\n\\text{面积} = \\pi r^2\n\\]\n";
	const render = () => renderMarkdown(md, 60, { style: plainStyle(), math, streaming: false }).join("\n");

	const before = render();
	assert.ok(!before.includes("\u{10EEEE}"), "fallback while downloading");
	assert.ok(before.includes("面积"));
	release();
	await settle();
	assert.ok(render().includes("\u{10EEEE}"), "image once the font is there");
});
