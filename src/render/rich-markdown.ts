/**
 * Drop-in replacement for pi-tui's Markdown component on assistant text.
 *
 * Streaming cost: pi rebuilds the component on every delta, so render results
 * are cached per top-level block in a module-wide LRU keyed by the block's raw
 * source. Appending text therefore re-renders only the block that changed
 * (normally the last one); everything above is a cache hit.
 */
import { sliceByColumn, visibleWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { state } from "../state.ts";
import type { Style } from "../style.ts";
import { renderBlock } from "./blocks.ts";
import { codeButtonText, type CopyStatus } from "./code-action.ts";
import type { CodeAction, MathRenderer, RenderContext } from "./context.ts";
import { lex } from "./lexer.ts";

export type MarkdownTransform = (markdown: string, availableWidth: number) => string;

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

export interface RichMarkdownOptions {
	style: Style;
	math: MathRenderer;
	streaming: boolean;
	paddingX: number;
	transform?: MarkdownTransform;
	copyCode?: (code: string) => Promise<void>;
	onCopyError?: (error: unknown) => void;
	requestRender?: () => void;
}

/** Render markdown to terminal lines of at most `width` columns (no padding). */
export function renderMarkdown(markdown: string, width: number, options: Omit<RichMarkdownOptions, "paddingX" | "transform">, actions?: CodeAction[]): string[] {
	const { style, math, streaming } = options;
	const tokens = lex(markdown, streaming);
	const ctx: RenderContext = { style, math, width, streaming, listDepth: 0 };
	const base = `${width}\0${style.key}\0${math.key}\0${state.version}\0${state.lineNumbers ? 1 : 0}${state.mermaid ? 1 : 0}\0`;
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

export class RichMarkdown implements Component {
	private cacheWidth = -1;
	private cacheVersion = "";
	private cacheLines: string[] = [];
	private actions: CodeAction[] = [];
	private pressed?: CodeAction;
	private copying = false;
	private feedback?: { action: CodeAction; status: CopyStatus };

	constructor(
		private readonly text: string,
		private readonly options: RichMarkdownOptions,
	) {}

	render(width: number): string[] {
		const version = `${this.options.style.key}\0${this.options.math.key}\0${state.version}`;
		if (width === this.cacheWidth && version === this.cacheVersion) return this.withFeedback();

		const padding = Math.max(0, this.options.paddingX);
		const contentWidth = Math.max(1, width - padding * 2);
		let markdown = this.text;
		try {
			markdown = this.options.transform?.(markdown, contentWidth) ?? markdown;
		} catch {
			// transformers are display sugar; ignore failures like pi does
		}
		const prefix = " ".repeat(padding);
		const actions: CodeAction[] = [];
		const lines = markdown.trim()
			? renderMarkdown(markdown, contentWidth, this.options, this.options.copyCode ? actions : undefined).map((line) => (line ? prefix + line : line))
			: [];
		this.actions = actions.map((action) => ({ ...action, x: action.x + padding }));
		this.pressed = undefined;
		this.feedback = undefined;

		this.cacheWidth = width;
		this.cacheVersion = version;
		this.cacheLines = lines;
		return lines;
	}

	private withFeedback(): string[] {
		if (!this.feedback) return this.cacheLines;
		const { action, status } = this.feedback;
		const lines = [...this.cacheLines];
		const line = lines[action.y];
		if (line === undefined) return lines;
		lines[action.y] = sliceByColumn(line, 0, action.x, true)
			+ this.options.style.fg("accent", codeButtonText(status))
			+ sliceByColumn(line, action.x + action.width, visibleWidth(line), true);
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (!this.options.copyCode || event.button !== "left" || event.shift || event.alt || event.ctrl) return;
		const hit = this.actions.find((action) => event.y === action.y && event.x >= action.x && event.x < action.x + action.width);
		if (event.type === "press" && hit) {
			this.pressed = hit;
			return { handled: true, capture: true, render: false };
		}
		if (event.type === "drag" && this.pressed) {
			if (hit !== this.pressed) this.pressed = undefined;
			return { handled: true, render: false };
		}
		if (event.type === "release") {
			const pressed = this.pressed;
			this.pressed = undefined;
			if (!pressed) return;
			if (hit === pressed) void this.copy(pressed);
			return { handled: true, render: false };
		}
	}

	private async copy(action: CodeAction): Promise<void> {
		if (this.copying) return;
		this.copying = true;
		try {
			await this.options.copyCode!(action.code);
		} catch (error) {
			this.feedback = undefined;
			this.options.requestRender?.();
			this.options.onCopyError?.(error);
			return;
		} finally {
			this.copying = false;
		}
		// A resize or invalidation may have replaced this action while copying.
		if (!this.actions.includes(action)) return;
		const feedback: { action: CodeAction; status: CopyStatus } = { action, status: "success" };
		this.feedback = feedback;
		this.options.requestRender?.();
		const timer = setTimeout(() => {
			if (this.feedback !== feedback) return;
			this.feedback = undefined;
			this.options.requestRender?.();
		}, 1800);
		timer.unref?.();
	}

	invalidate(): void {
		this.cacheWidth = -1;
	}
}
