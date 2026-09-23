/**
 * Markdown lexer: marked (the instance pi-tui ships) plus math tokens.
 *
 * Block math:  $$…$$, \[…\], \begin{equation|align|gather|…}…\end{…} at line start.
 * Inline math: $$…$$, \(…\), $…$ (pandoc rules: no space inside the delimiters,
 *              closing $ not followed by a digit, so "$5 and $10" stays text).
 *
 * While streaming, an unclosed block formula at the end of the text becomes a
 * `blockMath` token with `closed: false` so it can be shown as dimmed source
 * instead of flickering through paragraph/escape rendering.
 */
import { Marked, type Token } from "@earendil-works/pi-tui";

export interface BlockMathToken {
	type: "blockMath";
	raw: string;
	text: string;
	closed: boolean;
}

export interface InlineMathToken {
	type: "inlineMath";
	raw: string;
	text: string;
	display: boolean;
}

const ENVIRONMENTS = "equation|align|alignat|gather|multline|flalign|eqnarray|split|cases|matrix|pmatrix|bmatrix|vmatrix";

const BLOCK_START = new RegExp(String.raw`(?:^|\n) {0,3}(?:\$\$|\\\[|\\begin\{(?:${ENVIRONMENTS})\*?\})`);
const BLOCK_DOLLAR = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/;
const BLOCK_BRACKET = /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n|$)/;
const BLOCK_ENV = new RegExp(String.raw`^ {0,3}(\\begin\{((?:${ENVIRONMENTS})\*?)\}[\s\S]+?\\end\{\2\})[ \t]*(?:\n|$)`);
const BLOCK_OPEN = new RegExp(String.raw`^ {0,3}(?:\$\$|\\\[|\\begin\{(?:${ENVIRONMENTS})\*?\})`);

const INLINE_DISPLAY = /^\$\$(?!\$)((?:\\.|[^\\$])+?)\$\$/;
const INLINE_PAREN = /^\\\(((?:\\.|[^\\\n]|\n(?!\n))+?)\\\)/;
const INLINE_DOLLAR = /^\$(?![\s$])((?:\\.|[^\\$\n])*?[^\s\\$])\$(?!\d)|^\$([^\s$\\])\$(?!\d)/;

function createMarked(streaming: boolean): Marked {
	const marked = new Marked({ gfm: true });
	marked.use({
		extensions: [
			{
				name: "blockMath",
				level: "block",
				start(src: string) {
					const m = BLOCK_START.exec(src);
					if (!m) return undefined;
					return m[0].startsWith("\n") ? m.index + 1 : m.index;
				},
				tokenizer(src: string) {
					let m = BLOCK_DOLLAR.exec(src);
					if (m) return { type: "blockMath", raw: m[0], text: m[1]!.trim(), closed: true };
					m = BLOCK_BRACKET.exec(src);
					if (m) return { type: "blockMath", raw: m[0], text: m[1]!.trim(), closed: true };
					m = BLOCK_ENV.exec(src);
					if (m) return { type: "blockMath", raw: m[0], text: m[1]!.trim(), closed: true };
					if (streaming && BLOCK_OPEN.test(src)) {
						// Unclosed formula at the tail of a streaming message.
						return { type: "blockMath", raw: src, text: src.trim(), closed: false };
					}
					return undefined;
				},
			},
			{
				name: "inlineMath",
				level: "inline",
				start(src: string) {
					const i = src.search(/\$|\\\(/);
					return i < 0 ? undefined : i;
				},
				tokenizer(src: string) {
					let m = INLINE_DISPLAY.exec(src);
					if (m) return { type: "inlineMath", raw: m[0], text: m[1]!.trim(), display: true };
					m = INLINE_PAREN.exec(src);
					if (m) return { type: "inlineMath", raw: m[0], text: m[1]!.trim(), display: false };
					m = INLINE_DOLLAR.exec(src);
					if (m) return { type: "inlineMath", raw: m[0], text: (m[1] ?? m[2])!, display: false };
					return undefined;
				},
			},
		],
	});
	return marked;
}

const lexers = { streaming: createMarked(true), final: createMarked(false) };

function fullLex(markdown: string, streaming: boolean): Token[] {
	return (streaming ? lexers.streaming : lexers.final).lexer(markdown);
}

/**
 * Incremental lexing for streaming.
 *
 * Each delta extends the previous text, and blocks that are followed by at
 * least two other blocks can no longer change: markdown only ever re-shapes
 * the last block(s) (a paragraph turning into a table header or setext
 * heading, a list absorbing a continuation, an unclosed fence). So the tokens
 * before the last two blocks are reused and only the tail is lexed again,
 * which keeps the per-delta cost flat instead of growing with the message.
 *
 * Falls back to a full lex when the text is not an extension of a recent one,
 * when token raws do not add up to the source, or when the text contains
 * link reference definitions (they resolve links anywhere in the document).
 */
interface LexEntry {
	src: string;
	tokens: Token[];
	/** Offsets where each top-level token starts (tokens.length + 1 entries). */
	offsets: number[];
}

const RECENT_LIMIT = 8;
const recent: LexEntry[] = [];
const REF_DEF = /^ {0,3}\[[^\]\n]+\]:/m;
const REUSE_BLOCKS_KEPT = 2;

export const lexStats = { full: 0, incremental: 0 };

function offsetsOf(tokens: Token[]): number[] {
	const offsets = [0];
	for (const t of tokens) offsets.push(offsets[offsets.length - 1]! + (t as any).raw.length);
	return offsets;
}

function remember(entry: LexEntry): void {
	const i = recent.findIndex((e) => entry.src.startsWith(e.src));
	if (i >= 0) recent.splice(i, 1);
	recent.push(entry);
	if (recent.length > RECENT_LIMIT) recent.shift();
}

function lexFrom(previous: LexEntry, src: string, streaming: boolean): Token[] | undefined {
	const { tokens, offsets } = previous;
	// Keep everything before the last REUSE_BLOCKS_KEPT non-space tokens.
	let cut = tokens.length;
	for (let seen = 0; cut > 0 && seen < REUSE_BLOCKS_KEPT; ) {
		cut--;
		if (tokens[cut]!.type !== "space") seen++;
	}
	if (cut === 0) return undefined;
	const offset = offsets[cut]!;
	// A definition anywhere can change how earlier links lex.
	if (REF_DEF.test(src)) return undefined;
	return tokens.slice(0, cut).concat(fullLex(src.slice(offset), streaming));
}

export function lex(markdown: string, streaming: boolean): Token[] {
	const src = markdown.includes("\r") ? markdown.replace(/\r\n?/g, "\n") : markdown;
	let previous: LexEntry | undefined;
	for (const entry of recent) {
		if (entry.src.length <= src.length && src.startsWith(entry.src) && (!previous || entry.src.length > previous.src.length)) previous = entry;
	}

	let tokens = previous ? lexFrom(previous, src, streaming) : undefined;
	if (tokens) lexStats.incremental++;
	else {
		tokens = fullLex(src, streaming);
		lexStats.full++;
	}
	const offsets = offsetsOf(tokens);
	// Only texts whose raws add up exactly can be extended later.
	if (offsets[offsets.length - 1] === src.length) remember({ src, tokens, offsets });

	if (streaming) {
		// trimPartialClosingFence mutates the last code token; never touch shared/cached tokens.
		const last = tokens[tokens.length - 1] as any;
		if (last && (last.type === "code" || last.type === "list" || last.type === "blockquote")) {
			tokens = tokens.slice(0, -1).concat(structuredClone(last));
			trimPartialClosingFence(tokens);
		}
	}
	return tokens;
}

export function clearLexCache(): void {
	recent.length = 0;
}

/** Lex inline markdown only (table cells are already lexed by marked, used for tests). */
export function lexInline(markdown: string): Token[] {
	return lexers.final.Lexer.lexInline(markdown, lexers.final.defaults);
}

/**
 * While a closing ``` is arriving character by character, marked treats the
 * partial fence as a code line. Drop it so the block does not flicker.
 * (Same idea as pi-tui's trimPartialClosingFences.)
 */
function trimPartialClosingFence(tokens: Token[]): void {
	const token = tokens[tokens.length - 1] as any;
	if (!token) return;
	if (token.type === "list") {
		trimPartialClosingFence(token.items[token.items.length - 1]?.tokens ?? []);
		return;
	}
	if (token.type === "blockquote") {
		trimPartialClosingFence(token.tokens ?? []);
		return;
	}
	if (token.type !== "code") return;
	const marker = /^ {0,3}(`{3,}|~{3,})/.exec(token.raw)?.[1];
	const lastLine = token.raw.replace(/\n$/, "").split("\n").pop()?.trim();
	if (!marker || !lastLine || lastLine.length >= marker.length) return;
	if (lastLine !== marker[0]!.repeat(lastLine.length)) return;
	token.text = token.text.slice(0, -lastLine.length).replace(/\n$/, "");
}
