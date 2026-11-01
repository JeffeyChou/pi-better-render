import assert from "node:assert/strict";
import { test } from "node:test";
import { noMath } from "../src/render/context.ts";
import { RichMarkdown } from "../src/render/rich-markdown.ts";
import { colorToHex, createStyle, FALLBACK_MATH_COLOR, guessAppearance, mathColorOf, sgrToHex, styleKey, type ColorLike, type ThemeLike } from "../src/style.ts";

/**
 * A theme shaped like pi 0.99+'s: `fgSgr` gives each token's escape sequence
 * ("" = terminal default, SGR 39) and `colors` the concrete colors, with the
 * terminal-default tokens resolved to the terminal's foreground.
 */
function fakeTheme(options: {
	name?: string;
	appearance?: string;
	fgSgr?: Record<string, string>;
	bgSgr?: Record<string, string>;
	colors?: Record<string, ColorLike>;
}): ThemeLike {
	const fg = (token: string) => options.fgSgr?.[token] || "\x1b[39m";
	return {
		name: options.name,
		appearance: options.appearance,
		colors: options.colors,
		fg: (token, text) => `${fg(token)}${text}\x1b[39m`,
		bold: (t) => t,
		italic: (t) => t,
		underline: (t) => t,
		getFgAnsi: fg,
		getBgAnsi: (token) => options.bgSgr?.[token] || "\x1b[49m",
	};
}

const rgb = (hex: string): ColorLike => ({ kind: "rgb", r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });

test("system theme on a light terminal: formulas use the terminal's foreground, not light gray (#5)", () => {
	// pi's system theme leaves body text at the terminal default; only theme.colors knows the color.
	const theme = fakeTheme({ name: "system", appearance: "light", colors: { text: rgb("#1f2328") } });
	assert.equal(theme.getFgAnsi("text"), "\x1b[39m");
	assert.equal(mathColorOf(theme), "#1f2328");
	assert.equal(createStyle(theme, () => undefined).mathColor, "#1f2328");
});

test("theme.colors wins over the 256-color approximation of the escape sequence", () => {
	const theme = fakeTheme({ fgSgr: { text: "\x1b[38;5;236m" }, colors: { text: rgb("#2e3036") } });
	assert.equal(mathColorOf(theme), "#2e3036");
});

test("explicit text colors without theme.colors (pi before 0.99) still come from the escape sequence", () => {
	assert.equal(mathColorOf(fakeTheme({ fgSgr: { text: "\x1b[38;2;31;35;40m" } })), "#1f2328");
	assert.equal(mathColorOf(fakeTheme({ fgSgr: { text: "\x1b[38;5;16m" } })), "#000000");
});

test("a terminal-default text color without theme.colors falls back by appearance", () => {
	const env = {};
	assert.equal(guessAppearance(fakeTheme({ appearance: "light" }), env), "light");
	assert.equal(guessAppearance(fakeTheme({ name: "my-light" }), env), "light");
	assert.equal(guessAppearance(fakeTheme({ name: "dark" }), env), "dark");
	assert.equal(guessAppearance(fakeTheme({}), { COLORFGBG: "0;15" }), "light");
	assert.equal(guessAppearance(fakeTheme({}), { COLORFGBG: "0;default;7" }), "light");
	assert.equal(guessAppearance(fakeTheme({}), { COLORFGBG: "15;0" }), "dark");
	// A declared appearance beats the environment.
	assert.equal(guessAppearance(fakeTheme({ appearance: "dark" }), { COLORFGBG: "0;15" }), "dark");
	assert.equal(mathColorOf(fakeTheme({ appearance: "light" })), FALLBACK_MATH_COLOR.light);
	assert.equal(mathColorOf(fakeTheme({ appearance: "dark" })), FALLBACK_MATH_COLOR.dark);
});

test("sgrToHex reads truecolor, 256 and the 16 basic colors; the default has no color", () => {
	assert.equal(sgrToHex("\x1b[38;2;1;2;3m"), "#010203");
	assert.equal(sgrToHex("\x1b[38;5;196m"), "#ff0000");
	assert.equal(sgrToHex("\x1b[30m"), "#000000");
	assert.equal(sgrToHex("\x1b[37m"), "#c0c0c0");
	assert.equal(sgrToHex("\x1b[97m"), "#ffffff");
	assert.equal(sgrToHex("\x1b[39m"), undefined);
	assert.equal(sgrToHex(""), undefined);
});

test("colorToHex converts every pi-tui color kind", () => {
	assert.equal(colorToHex(rgb("#1f2328")), "#1f2328");
	assert.equal(colorToHex({ kind: "indexed", index: 15 }), "#ffffff");
	assert.equal(colorToHex({ kind: "oklch", l: 1, c: 0, h: 0 }), "#ffffff");
	assert.equal(colorToHex({ kind: "oklch", l: 0, c: 0, h: 0 }), "#000000");
	assert.equal(colorToHex({ kind: "oklch", l: 0.627955, c: 0.257683, h: 29.2339 }), "#ff0000");
	assert.equal(colorToHex(undefined), undefined);
	assert.equal(colorToHex({ kind: "rgb", r: Number.NaN, g: 0, b: 0 }), undefined);
});

test("the style key changes with any color that reaches the output", () => {
	const base = { name: "system", fgSgr: { mdLink: "\x1b[38;2;0;0;255m" }, colors: { text: rgb("#000000") } };
	const key = styleKey(fakeTheme(base));
	assert.notEqual(styleKey(fakeTheme({ ...base, fgSgr: { mdLink: "\x1b[38;2;0;0;200m" } })), key);
	assert.notEqual(styleKey(fakeTheme({ ...base, bgSgr: { selectedBg: "\x1b[48;2;1;1;1m" } })), key);
	// Same escape sequences, different terminal foreground: only the formula color differs.
	assert.notEqual(styleKey(fakeTheme({ ...base, colors: { text: rgb("#ffffff") } })), key);
	assert.equal(styleKey(fakeTheme(base)), key);
});

test("a component given a style getter recolors after a theme switch without being rebuilt", () => {
	let theme = fakeTheme({ name: "system", appearance: "dark", bgSgr: { toolPendingBg: "\x1b[48;2;40;40;50m" }, colors: { text: rgb("#e5e5e7") } });
	const component = new RichMarkdown("```sh\necho hi\n```", { style: () => createStyle(theme, () => undefined), math: noMath, streaming: false, paddingX: 1 });
	assert.match(component.render(40).join("\n"), /\x1b\[48;2;40;40;50m/);
	theme = fakeTheme({ name: "system", appearance: "light", bgSgr: { toolPendingBg: "\x1b[48;2;230;230;235m" }, colors: { text: rgb("#1f2328") } });
	const after = component.render(40).join("\n");
	assert.match(after, /\x1b\[48;2;230;230;235m/);
	assert.doesNotMatch(after, /\x1b\[48;2;40;40;50m/);
});
