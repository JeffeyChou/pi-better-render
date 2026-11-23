/**
 * Markdown → terminal lines, for any host.
 *
 * Streaming cost: hosts may re-render a growing message on every delta, so
 * render results are cached per top-level block in a module-wide LRU keyed by
 * the block's raw source. Appending text therefore re-renders only the block
 * that changed (normally the last one); everything above is a cache hit.
 */
import { state } from "../state.ts";
import type { Style } from "../style.ts";
import { renderBlock } from "./blocks.ts";
import type { CodeAction, DiagramRenderer, MathRenderer, RenderContext } from "./context.ts";
import { lex } from "./lexer.ts";

const BLOCK_CACHE_LIMIT = 4000;
type RenderedBlock = { lines: string[]; actions: CodeAction[] };
const blockCache = new Map<string, RenderedBlock>();
const byToken = new WeakMap<object, { context: string; block: RenderedBlock }>();

export const cacheStats = { hits: 0, misses: 0 };

function cached(key: string, compute: () => RenderedBlock): RenderedBlock {
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

export interface RenderOptions {
	style: Style;
	math: MathRenderer;
	streaming: boolean;
	diagram?: DiagramRenderer;
}

/** Render markdown to terminal lines of at most `width` columns (no padding). */
export function renderMarkdown(markdown: string, width: number, options: RenderOptions, actions?: CodeAction[]): string[] {
	const { style, math, streaming, diagram } = options;
	const tokens = lex(markdown, streaming);
	const ctx: RenderContext = { style, math, width, streaming, listDepth: 0, diagram };
	const base = `${width}\0${style.key}\0${math.key}\0${state.version}\0${state.lineNumbers ? 1 : 0}${state.mermaid ? 1 : 0}${diagram ? 1 : 0}\0`;
	const lastIndex = tokens.length - 1;
	const lines: string[] = [];
	tokens.forEach((token: any, i) => {
		if (token.type === "space" || token.type === "def") return;
		// Only the trailing block of a streaming message can still be incomplete. Earlier
		// blocks render exactly as in the final message (and share its cache entries),
		// unless math is deferred until message_end.
		const phase = !streaming ? "f" : i === lastIndex ? "s" : state.math === "final" ? "m" : "f";
		const context = base + phase + (actions ? "buttons" : "plain");
		// Fast path: incremental lexing hands back the same token objects for the
		// stable prefix, so identity lookups avoid hashing long block sources.
		const known = byToken.get(token);
		let block: RenderedBlock;
		if (known && known.context === context) {
			cacheStats.hits++;
			block = known.block;
		} else {
			block = cached(`${context}\0${token.type}\0${token.raw}`, () => {
				const buttons: CodeAction[] = [];
				const rendered = renderBlock(token, { ...ctx, streaming: phase !== "f", onCode: actions ? (action) => buttons.push(action) : undefined });
				return { lines: rendered, actions: buttons };
			});
			byToken.set(token, { context, block });
		}
		if (block.lines.length === 0) return;
		if (lines.length > 0) lines.push("");
		for (const action of block.actions) actions?.push({ ...action, y: action.y + lines.length });
		lines.push(...block.lines);
	});
	return lines;
}
