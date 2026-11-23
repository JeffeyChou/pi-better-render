/**
 * Safety net for the LLM context.
 *
 * Rendering never writes into messages (the patch only swaps display
 * components), so in practice there is nothing to remove. This guards against
 * any path that might copy rendered terminal output back into a message
 * (copy/paste into the editor, another extension reading rendered lines, …):
 * Kitty/iTerm2 image escapes and Kitty placeholder cells are stripped from
 * user/assistant text before every provider request.
 */

const KITTY_APC = /\x1b_G[^\x1b]*(?:\x1b\\)?/g;
const ITERM_OSC = /\x1b\]1337;File=[^\x07\x1b]*(?:\x07|\x1b\\)?/g;
/** A whole placeholder run: id color, cells, color reset. */
const PLACEHOLDER_RUN = /\x1b\[38;2;\d{1,3};\d{1,3};\d{1,3}m(?:\u{10EEEE}\p{M}*)+\x1b\[39m/gu;
const PLACEHOLDER_CELL = /\u{10EEEE}\p{M}*/gu;

const QUICK_CHECK = /\x1b_G|\x1b\]1337;|\u{10EEEE}/u;

export function containsRenderArtifacts(text: string): boolean {
	return QUICK_CHECK.test(text);
}

export function stripRenderArtifacts(text: string): string {
	if (!containsRenderArtifacts(text)) return text;
	return text.replace(KITTY_APC, "").replace(ITERM_OSC, "").replace(PLACEHOLDER_RUN, "").replace(PLACEHOLDER_CELL, "");
}

interface Part {
	type: string;
	text?: string;
	thinking?: string;
}

function cleanParts(content: unknown): { changed: boolean; value: unknown } {
	if (typeof content === "string") {
		const value = stripRenderArtifacts(content);
		return { changed: value !== content, value };
	}
	if (!Array.isArray(content)) return { changed: false, value: content };
	let changed = false;
	const value = content.map((part: Part) => {
		if (part?.type === "text" && typeof part.text === "string" && containsRenderArtifacts(part.text)) {
			changed = true;
			return { ...part, text: stripRenderArtifacts(part.text) };
		}
		if (part?.type === "thinking" && typeof part.thinking === "string" && containsRenderArtifacts(part.thinking)) {
			changed = true;
			return { ...part, thinking: stripRenderArtifacts(part.thinking) };
		}
		return part;
	});
	return { changed, value };
}

/** Returns sanitized messages, or undefined when nothing needed cleaning (the normal case). */
export function sanitizeMessages<T extends { role?: string; content?: unknown }>(messages: T[]): { messages: T[]; cleaned: number } | undefined {
	let cleaned = 0;
	const out = messages.map((message) => {
		if (message?.role !== "user" && message?.role !== "assistant") return message;
		const { changed, value } = cleanParts(message.content);
		if (!changed) return message;
		cleaned++;
		return { ...message, content: value };
	});
	return cleaned > 0 ? { messages: out, cleaned } : undefined;
}
