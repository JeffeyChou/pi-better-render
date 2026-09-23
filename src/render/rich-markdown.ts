/**
 * Drop-in replacement for pi-tui's Markdown component on assistant text.
 *
 * Streaming cost: pi rebuilds the component on every delta, so render results
 * are cached per top-level block in a module-wide LRU keyed by the block's raw
 * source. Appending text therefore re-renders only the block that changed
 * (normally the last one); everything above is a cache hit.
 */
import type { Component } from "@earendil-works/pi-tui";
import { state } from "../state.ts";
import type { Style } from "../style.ts";
import { renderBlock } from "./blocks.ts";
import type { MathRenderer, RenderContext } from "./context.ts";
import { lex } from "./lexer.ts";

export type MarkdownTransform = (markdown: string, availableWidth: number) => string;

const BLOCK_CACHE_LIMIT = 4000;
const blockCache = new Map<string, string[]>();
const byToken = new WeakMap<object, { context: string; lines: string[] }>();

export const cacheStats = { hits: 0, misses: 0 };

function cached(key: string, compute: () => string[]): string[] {
	const hit = blockCache.get(key);
	if (hit) {
		cacheStats.hits++;
		blockCache.delete(key);
		blockCache.set(key, hit);
		return hit;
	}
	cacheStats.misses++;
	const value = compute();
	blockCache.set(key, value);
	if (blockCache.size > BLOCK_CACHE_LIMIT) {
		const oldest = blockCache.keys().next().value;
		if (oldest !== undefined) blockCache.delete(oldest);
	}
	return value;
}

export function clearBlockCache(): void {
	blockCache.clear();
	cacheStats.hits = 0;
	cacheStats.misses = 0;
}

export interface RichMarkdownOptions {
	style: Style;
	math: MathRenderer;
	streaming: boolean;
	paddingX: number;
	transform?: MarkdownTransform;
}

/** Render markdown to terminal lines of at most `width` columns (no padding). */
export function renderMarkdown(markdown: string, width: number, options: Omit<RichMarkdownOptions, "paddingX" | "transform">): string[] {
	const { style, math, streaming } = options;
	const tokens = lex(markdown, streaming);
	const ctx: RenderContext = { style, math, width, streaming, listDepth: 0 };
	const base = `${width}\0${style.key}\0${math.key}\0${state.version}\0${state.lineNumbers ? 1 : 0}\0`;
	const lastIndex = tokens.length - 1;
	const lines: string[] = [];
	tokens.forEach((token: any, i) => {
		if (token.type === "space" || token.type === "def") return;
		// Only the trailing block of a streaming message can still be incomplete. Earlier
		// blocks render exactly as in the final message (and share its cache entries),
		// unless math is deferred until message_end.
		const phase = !streaming ? "f" : i === lastIndex ? "s" : state.math === "final" ? "m" : "f";
		const context = base + phase;
		// Fast path: incremental lexing hands back the same token objects for the
		// stable prefix, so identity lookups avoid hashing long block sources.
		const known = byToken.get(token);
		let block: string[];
		if (known && known.context === context) {
			cacheStats.hits++;
			block = known.lines;
		} else {
			block = cached(`${context}\0${token.type}\0${token.raw}`, () => renderBlock(token, { ...ctx, streaming: phase !== "f" }));
			byToken.set(token, { context, lines: block });
		}
		if (block.length === 0) return;
		if (lines.length > 0) lines.push("");
		lines.push(...block);
	});
	return lines;
}

export class RichMarkdown implements Component {
	private cacheWidth = -1;
	private cacheVersion = "";
	private cacheLines: string[] = [];

	constructor(
		private readonly text: string,
		private readonly options: RichMarkdownOptions,
	) {}

	render(width: number): string[] {
		const version = `${this.options.style.key}\0${this.options.math.key}\0${state.version}`;
		if (width === this.cacheWidth && version === this.cacheVersion) return this.cacheLines;

		const padding = Math.max(0, this.options.paddingX);
		const contentWidth = Math.max(1, width - padding * 2);
		let markdown = this.text;
		try {
			markdown = this.options.transform?.(markdown, contentWidth) ?? markdown;
		} catch {
			// transformers are display sugar; ignore failures like pi does
		}
		const prefix = " ".repeat(padding);
		const lines = markdown.trim()
			? renderMarkdown(markdown, contentWidth, this.options).map((line) => (line ? prefix + line : line))
			: [];

		this.cacheWidth = width;
		this.cacheVersion = version;
		this.cacheLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cacheWidth = -1;
	}
}
