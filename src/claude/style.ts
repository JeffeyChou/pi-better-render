/**
 * The Style the Claude Code adapter renders with.
 *
 * The shared renderers produce ANSI-styled lines; Claude Code's `Text` element
 * takes styles as props instead. So colors are written as SGR 256-color codes
 * from a private range (38;5;200+i) that stand for Claude theme keys, which
 * keeps them intact through the core's ANSI-aware wrapping and slicing, and
 * layout.ts turns them back into `color: "<theme key>"` props. Colors thus
 * follow whichever Claude theme is active.
 */
import type { Style } from "../core/style.ts";

/** Claude Code theme keys used for Markdown parts (see ThemeKey in the mod API). */
export const THEME_KEYS = ["claude", "suggestion", "permission", "inactive", "subtle", "success", "warning", "error", "text"] as const;
export type ClaudeThemeKey = (typeof THEME_KEYS)[number];

export const THEME_CODE_BASE = 200;

/** pi theme tokens (what the renderers ask for) → Claude theme keys; undefined keeps the default text color. */
const TOKENS: Record<string, ClaudeThemeKey | "dim" | undefined> = {
	text: undefined,
	accent: "claude",
	muted: "inactive",
	dim: "dim",
	success: "success",
	warning: "warning",
	error: "error",
	mdHeading: "claude",
	mdLink: "suggestion",
	mdLinkUrl: "inactive",
	mdCode: "permission",
	mdCodeBlock: undefined,
	mdCodeBlockBorder: "inactive",
	mdQuote: "inactive",
	mdQuoteBorder: "inactive",
	mdHr: "inactive",
	mdListBullet: undefined,
};

/** Formula colors per Claude theme family (its body text color). */
export const MATH_COLORS = { dark: "#ffffff", light: "#000000" } as const;

/** Light or dark from Claude's `theme` setting (`dark`, `light-daltonized`, `light-ansi`, …). */
export function themeAppearance(theme: unknown): "dark" | "light" {
	return typeof theme === "string" && theme.startsWith("light") ? "light" : "dark";
}

export function claudeStyle(mathColor: string): Style {
	return {
		key: `claude|${mathColor}`,
		fg(token, text) {
			const key = TOKENS[token];
			if (key === undefined) return text;
			if (key === "dim") return `\x1b[2m${text}\x1b[22m`;
			return `\x1b[38;5;${THEME_CODE_BASE + THEME_KEYS.indexOf(key)}m${text}\x1b[39m`;
		},
		bold: (t) => `\x1b[1m${t}\x1b[22m`,
		italic: (t) => `\x1b[3m${t}\x1b[23m`,
		underline: (t) => `\x1b[4m${t}\x1b[24m`,
		strike: (t) => `\x1b[9m${t}\x1b[29m`,
		codeBg: "",
		headerBg: "",
		highlight: () => undefined,
		mathColor,
	};
}
