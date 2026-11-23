/**
 * The terminal text toolkit the renderers use: Markdown lexer, display widths,
 * ANSI-aware wrapping and slicing, the LaTeX→Unicode fallback.
 *
 * Every renderer imports these from here, never from pi-tui directly. Inside
 * pi the import resolves to pi's own already-loaded pi-tui; bundles for other
 * hosts (tools/build-claude.mjs) point it at pi-tui's pure modules instead, so
 * no terminal or Node code comes along.
 */
export { Marked, renderLatex, sliceByColumn, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
export type { Token } from "@earendil-works/pi-tui";

/** OSC 8 hyperlink around already-styled text (same sequence pi-tui emits). */
export function hyperlink(text: string, url: string): string {
	return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}
