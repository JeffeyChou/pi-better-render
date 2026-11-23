/**
 * One assistant text block → what an element-based host draws.
 *
 * Only top-level blocks that hold math or a table are rendered by the shared
 * core ("rich" parts); every run of other blocks is handed back as Markdown
 * source for the host's own renderer, so code highlighting, links and the
 * host's look stay as they were. The source text itself is never changed:
 * each part is a verbatim slice of it.
 */
import { prepareSvg } from "../core/math/mathjax.ts";
import { renderMarkdown } from "../core/render/markdown.ts";
import { lex } from "../core/render/lexer.ts";
import { latexFallback } from "../core/render/inline.ts";
import { layoutLines, type Row } from "./layout.ts";
import type { ElementMathRenderer } from "./math.ts";
import { claudeStyle } from "./style.ts";

export type Part = { kind: "markdown"; text: string } | { kind: "rich"; rows: Row[] };

export interface MessagePlan {
	/** False when nothing in the text needs the core: draw the host's own component. */
	rich: boolean;
	parts: Part[];
}

export interface PlanOptions {
	width: number;
	math: ElementMathRenderer;
	mathColor: string;
}

interface MathRef {
	tex: string;
	display: boolean;
}

/** Every formula in a token tree (block formulas only once closed). */
function collectMath(node: unknown, out: MathRef[]): void {
	if (Array.isArray(node)) {
		for (const child of node) collectMath(child, out);
		return;
	}
	if (!node || typeof node !== "object") return;
	const token = node as Record<string, unknown>;
	if (token.type === "inlineMath" && typeof token.text === "string") out.push({ tex: token.text, display: false });
	else if (token.type === "blockMath" && typeof token.text === "string" && token.closed) out.push({ tex: token.text, display: true });
	for (const key of ["tokens", "items", "header", "rows", "cells"]) {
		if (key in token) collectMath(token[key], out);
	}
}

function needsCore(token: any): boolean {
	if (token.type === "table" || token.type === "blockMath") return true;
	const math: MathRef[] = [];
	collectMath(token, math);
	return math.length > 0;
}

/** Quick test before lexing: could this text hold math or a table at all? */
export function mightNeedCore(text: string): boolean {
	return /\$|\\\(|\\\[|\\begin\{|\|/.test(text);
}

/** Alt text for a formula picture: its Unicode approximation. */
export function formulaAlt(tex: string, display: boolean): string {
	return latexFallback(tex, display).replace(/\s*\n\s*/g, " ");
}

export async function planMessage(text: string, options: PlanOptions): Promise<MessagePlan> {
	if (!mightNeedCore(text)) return { rich: false, parts: [{ kind: "markdown", text }] };
	const tokens = lex(text, false);
	const groups: { rich: boolean; raw: string; tokens: any[] }[] = [];
	for (const token of tokens as any[]) {
		const rich = token.type === "space" ? (groups[groups.length - 1]?.rich ?? false) : needsCore(token);
		const last = groups[groups.length - 1];
		if (last && last.rich === rich) {
			last.raw += token.raw;
			last.tokens.push(token);
		} else groups.push({ rich, raw: token.raw, tokens: [token] });
	}
	if (!groups.some((g) => g.rich)) return { rich: false, parts: [{ kind: "markdown", text }] };

	const formulas: MathRef[] = [];
	for (const group of groups) if (group.rich) collectMath(group.tokens, formulas);
	for (const formula of formulas) await prepareSvg(formula.tex, formula.display);

	const style = claudeStyle(options.mathColor);
	const parts: Part[] = [];
	for (const group of groups) {
		const raw = group.raw.replace(/^\n+|\n+$/g, "");
		if (!raw.trim()) continue;
		if (!group.rich) {
			parts.push({ kind: "markdown", text: raw });
			continue;
		}
		const lines = renderMarkdown(raw, Math.max(10, options.width), { style, math: options.math, streaming: false });
		parts.push({ kind: "rich", rows: layoutLines(lines, options.math.registry) });
	}
	return { rich: true, parts };
}
