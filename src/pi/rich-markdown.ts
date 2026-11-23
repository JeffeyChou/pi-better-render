/**
 * Drop-in replacement for pi-tui's Markdown component on assistant text.
 *
 * Rendering itself is the shared core (src/core/render/markdown.ts); this
 * component adds pi's padding, the optional Markdown transform, theme
 * following and the clickable copy buttons on code blocks.
 */
import { type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { codeButtonText, type CopyStatus } from "../core/render/code-action.ts";
import type { CodeAction } from "../core/render/context.ts";
import { renderMarkdown as renderCore, type RenderOptions } from "../core/render/markdown.ts";
import { state } from "../core/state.ts";
import type { Style } from "../core/style.ts";
import { sliceByColumn, visibleWidth } from "../core/text.ts";

import { mermaidDiagram } from "./mermaid.ts";

export { cacheStats, clearBlockCache, type RenderOptions } from "../core/render/markdown.ts";

/** The core renderer with pi's defaults: mermaid blocks become diagrams unless `diagram` says otherwise. */
export function renderMarkdown(markdown: string, width: number, options: RenderOptions, actions?: CodeAction[]): string[] {
	return renderCore(markdown, width, { ...options, diagram: "diagram" in options ? options.diagram : mermaidDiagram }, actions);
}

export type MarkdownTransform = (markdown: string, availableWidth: number) => string;

export interface RichMarkdownOptions extends Omit<RenderOptions, "style"> {
	/** A Style, or a function returning the current one on every render (follows theme switches). */
	style: Style | (() => Style);
	paddingX: number;
	transform?: MarkdownTransform;
	copyCode?: (code: string) => Promise<void>;
	onCopyError?: (error: unknown) => void;
	requestRender?: () => void;
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

	private style(): Style {
		const { style } = this.options;
		return typeof style === "function" ? style() : style;
	}

	render(width: number): string[] {
		const style = this.style();
		const version = `${style.key}\0${this.options.math.key}\0${state.version}`;
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
			? renderCore(markdown, contentWidth, { style, math: this.options.math, streaming: this.options.streaming, diagram: "diagram" in this.options ? this.options.diagram : mermaidDiagram }, this.options.copyCode ? actions : undefined)
				.map((line) => (line ? prefix + line : line))
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
			+ this.style().fg("accent", codeButtonText(status))
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
