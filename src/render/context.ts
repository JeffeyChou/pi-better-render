import type { Style } from "../style.ts";

/** Turns formulas into terminal output; returns undefined to request the text fallback. */
export interface MathRenderer {
	/** Single-row image placeholder string for an inline formula. */
	inline(tex: string, display: boolean, streaming: boolean): string | undefined;
	/** Placeholder rows for a display formula no wider than `maxColumns`. */
	block(tex: string, maxColumns: number, streaming: boolean): string[] | undefined;
	/** Part of every cache key: changes when image output would change. */
	readonly key: string;
}

export interface RenderContext {
	style: Style;
	math: MathRenderer;
	/** Available columns for the block being rendered. */
	width: number;
	/** The whole message is still streaming. */
	streaming: boolean;
	/** List nesting depth (bullet style rotates with it). */
	listDepth: number;
	/** Applied to plain text leaves (e.g. dim color inside block quotes). */
	textStyle?: (text: string) => string;
}

export const noMath: MathRenderer = {
	inline: () => undefined,
	block: () => undefined,
	key: "none",
};
