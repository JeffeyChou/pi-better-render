/**
 * Colors and text attributes used by the renderers.
 *
 * Built from pi's live Theme at runtime; tests use `plainStyle()` so that
 * render output can be compared without ANSI noise.
 */

/** A concrete color as pi-tui reports it in `theme.colors` (pi 0.99+). */
export type ColorLike =
	| { readonly kind: "rgb"; readonly r: number; readonly g: number; readonly b: number }
	| { readonly kind: "indexed"; readonly index: number }
	| { readonly kind: "oklch"; readonly l: number; readonly c: number; readonly h: number };

/** The subset of pi's `Theme` class the renderers need. */
export interface ThemeLike {
	readonly name?: string;
	/**
	 * pi 0.99+: concrete colors of all tokens. Tokens a theme leaves at the
	 * terminal default (the `system` theme's body text) report the terminal's
	 * own color here, while `getFgAnsi` only returns SGR 39.
	 */
	readonly colors?: Readonly<Record<string, ColorLike | undefined>>;
	/** pi 0.99+: the background the theme is designed for. */
	readonly appearance?: "dark" | "light" | string;
	fg(color: string, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
	underline(text: string): string;
	strikethrough?(text: string): string;
	getFgAnsi(color: string): string;
	getBgAnsi(color: string): string;
}

export type Highlighter = (code: string, lang?: string) => string[] | undefined;

export interface Style {
	/** Changes whenever any color changes; part of every render cache key. */
	readonly key: string;
	fg(color: string, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
	underline(text: string): string;
	strike(text: string): string;
	/** ANSI "set background" sequence for code blocks, or "" for none. */
	readonly codeBg: string;
	/** ANSI "set background" sequence for table headers, or "" for none. */
	readonly headerBg: string;
	highlight: Highlighter;
	/** Foreground color for formula images, as #rrggbb. */
	readonly mathColor: string;
}

const XTERM_BASE = [
	"#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
	"#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
];

function safe(fn: () => string): string {
	try {
		return fn();
	} catch {
		return "";
	}
}

function hex2(n: number): string {
	return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

export function ansi256ToHex(n: number): string {
	if (n < 16) return XTERM_BASE[n]!;
	if (n >= 232) {
		const v = 8 + (n - 232) * 10;
		return `#${hex2(v)}${hex2(v)}${hex2(v)}`;
	}
	const i = n - 16;
	const steps = [0, 95, 135, 175, 215, 255];
	return `#${hex2(steps[Math.floor(i / 36)]!)}${hex2(steps[Math.floor(i / 6) % 6]!)}${hex2(steps[i % 6]!)}`;
}

/**
 * Extract a #rrggbb color from an SGR foreground/background sequence. The
 * terminal default (SGR 39/49) has no color of its own and gives undefined.
 */
export function sgrToHex(sgr: string): string | undefined {
	const truecolor = /\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/.exec(sgr);
	if (truecolor) return `#${hex2(+truecolor[1]!)}${hex2(+truecolor[2]!)}${hex2(+truecolor[3]!)}`;
	const indexed = /\x1b\[(?:38|48);5;(\d+)m/.exec(sgr);
	if (indexed) return ansi256ToHex(+indexed[1]!);
	const basic = /\x1b\[(3[0-7]|4[0-7]|9[0-7]|10[0-7])m/.exec(sgr);
	if (basic) {
		const code = +basic[1]!;
		return ansi256ToHex(code >= 90 ? (code % 10) + 8 : code % 10);
	}
	return undefined;
}

function srgbChannel(linear: number): number {
	const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
	return v * 255;
}

/** #rrggbb of a pi-tui color, or undefined for anything unrecognized. */
export function colorToHex(color: unknown): string | undefined {
	if (!color || typeof color !== "object") return undefined;
	const c = color as Partial<Record<string, unknown>>;
	const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
	if (c.kind === "indexed") {
		const index = num(c.index);
		return index !== undefined && index >= 0 && index < 256 ? ansi256ToHex(Math.round(index)) : undefined;
	}
	if (c.kind === "oklch") {
		const [l, chroma, h] = [num(c.l), num(c.c), num(c.h)];
		if (l === undefined || chroma === undefined || h === undefined) return undefined;
		const a = chroma * Math.cos((h * Math.PI) / 180);
		const b = chroma * Math.sin((h * Math.PI) / 180);
		const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
		const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
		const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
		const r = srgbChannel(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp);
		const g = srgbChannel(-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp);
		const bl = srgbChannel(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp);
		return `#${hex2(r)}${hex2(g)}${hex2(bl)}`;
	}
	const [r, g, b] = [num(c.r), num(c.g), num(c.b)];
	if (r === undefined || g === undefined || b === undefined) return undefined;
	return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** Formula colors when the theme's text color cannot be determined. */
export const FALLBACK_MATH_COLOR = { dark: "#d4d4d4", light: "#1f2328" } as const;

/**
 * Light or dark background: the theme's own declaration (pi 0.99+), else the
 * terminal's COLORFGBG ("fg;bg", where 7 and 9–15 are light backgrounds),
 * else a theme named like "light", else dark.
 */
export function guessAppearance(theme: ThemeLike, env: NodeJS.ProcessEnv = process.env): "dark" | "light" {
	let declared: unknown;
	try {
		declared = theme.appearance;
	} catch {
		declared = undefined;
	}
	if (declared === "light" || declared === "dark") return declared;
	const bg = env.COLORFGBG?.split(";").pop();
	if (bg && /^\d+$/.test(bg)) return +bg === 7 || (+bg >= 9 && +bg <= 15) ? "light" : "dark";
	return /light/i.test(theme.name ?? "") ? "light" : "dark";
}

/**
 * The color formulas are drawn in: the theme's body text color. Themes that
 * leave it at the terminal default (pi's `system` theme does on most
 * terminals) only report it through `theme.colors`; older pi versions get a
 * fallback that suits the background.
 */
export function mathColorOf(theme: ThemeLike, textAnsi = safe(() => theme.getFgAnsi("text"))): string {
	let concrete: unknown;
	try {
		concrete = theme.colors?.text;
	} catch {
		concrete = undefined;
	}
	return colorToHex(concrete) ?? sgrToHex(textAnsi) ?? FALLBACK_MATH_COLOR[guessAppearance(theme)];
}

/** Foreground tokens whose colors end up in rendered output (renderers and the highlighter). */
const KEY_FG_TOKENS = [
	"text", "accent", "muted", "dim", "success", "warning", "error",
	"mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder",
	"mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
	"syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
	"syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
];
const KEY_BG_TOKENS = ["toolPendingBg", "selectedBg"];

/**
 * Identifies everything a theme contributes to rendered output, so that
 * caches miss (and messages already on screen are redrawn) after a switch.
 */
export function styleKey(theme: ThemeLike): string {
	const parts = [theme.name ?? ""];
	for (const token of KEY_FG_TOKENS) parts.push(safe(() => theme.getFgAnsi(token)));
	for (const token of KEY_BG_TOKENS) parts.push(safe(() => theme.getBgAnsi(token)));
	parts.push(mathColorOf(theme));
	return parts.join("|");
}

export function createStyle(theme: ThemeLike, highlight: Highlighter, key = styleKey(theme)): Style {
	const codeBg = safe(() => theme.getBgAnsi("toolPendingBg"));
	const headerBg = safe(() => theme.getBgAnsi("selectedBg"));
	const mathColor = mathColorOf(theme);
	return {
		key,
		fg: (color, text) => {
			try {
				return theme.fg(color, text);
			} catch {
				return text;
			}
		},
		bold: (t) => theme.bold(t),
		italic: (t) => theme.italic(t),
		underline: (t) => theme.underline(t),
		strike: (t) => (theme.strikethrough ? theme.strikethrough(t) : `\x1b[9m${t}\x1b[29m`),
		codeBg,
		headerBg,
		highlight,
		mathColor,
	};
}

/** Style without any escape sequences (tests, snapshot comparisons). */
export function plainStyle(): Style {
	const id = (t: string) => t;
	return {
		key: "plain",
		fg: (_c, t) => t,
		bold: id,
		italic: id,
		underline: id,
		strike: id,
		codeBg: "",
		headerBg: "",
		highlight: () => undefined,
		mathColor: FALLBACK_MATH_COLOR.dark,
	};
}
