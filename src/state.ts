/** Runtime switches shared by the patch, the renderers and the /richmd command. */

export type MathMode = "streaming" | "final" | "off";

export const state = {
	/** Rich Markdown rendering replaces pi's built-in assistant Markdown. */
	enabled: true,
	/** When formulas become images: while streaming, only after message_end, or never. */
	math: "streaming" as MathMode,
	/** Show line numbers in code blocks. */
	lineNumbers: false,
	/** Append context-sanitizer diagnostics to ~/.pi/agent/richmd-debug.log. */
	debug: process.env.PI_RICHMD_DEBUG === "1",
	/** Bumped whenever something that affects rendered output changes (mode, theme, math engine loaded). */
	version: 0,
};

export function bumpVersion(): void {
	state.version++;
}

let renderRequester: (() => void) | undefined;

export function setRenderRequester(fn: (() => void) | undefined): void {
	renderRequester = fn;
}

/** Ask the TUI for a new frame (used after asynchronous work finishes). */
export function requestRender(): void {
	renderRequester?.();
}
