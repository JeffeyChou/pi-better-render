/**
 * Colors and text attributes used by the renderers.
 *
 * Built from pi's live Theme at runtime; tests use `plainStyle()` so that
 * render output can be compared without ANSI noise.
 */

/** The subset of pi's `Theme` class the renderers need. */
export interface ThemeLike {
	readonly name?: string;
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

/** Extract a #rrggbb color from an SGR foreground/background sequence. */
export function sgrToHex(sgr: string): string | undefined {
	const truecolor = /\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/.exec(sgr);
	if (truecolor) return `#${hex2(+truecolor[1]!)}${hex2(+truecolor[2]!)}${hex2(+truecolor[3]!)}`;
	const indexed = /\x1b\[(?:38|48);5;(\d+)m/.exec(sgr);
	if (indexed) return ansi256ToHex(+indexed[1]!);
	return undefined;
}

function safe(fn: () => string): string {
	try {
		return fn();
	} catch {
		return "";
	}
}

export function createStyle(theme: ThemeLike, highlight: Highlighter): Style {
	const codeBg = safe(() => theme.getBgAnsi("toolPendingBg"));
	const headerBg = safe(() => theme.getBgAnsi("selectedBg"));
	const textAnsi = safe(() => theme.getFgAnsi("text"));
	const mathColor = sgrToHex(textAnsi) ?? "#d4d4d4";
	const key = [
		theme.name ?? "",
		textAnsi,
		codeBg,
		safe(() => theme.getFgAnsi("mdHeading")),
		safe(() => theme.getFgAnsi("mdCode")),
		safe(() => theme.getFgAnsi("accent")),
	].join("|");
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
		mathColor: "#d4d4d4",
	};
}
