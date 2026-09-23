/**
 * Swap pi's Markdown component for RichMarkdown inside assistant messages.
 *
 * `AssistantMessageComponent.updateContent` rebuilds its children from the
 * message on every streaming delta. We let it run unchanged, then replace each
 * direct Markdown child (assistant text blocks; thinking blocks are wrapped in
 * a MouseRegion and stay native) with a RichMarkdown built from the same text.
 * The message object is never touched, so sessions and LLM context keep the
 * original Markdown/LaTeX.
 *
 * Same lifecycle as pi-tool-display's UserMessageComponent patch: idempotent,
 * versioned, fully restorable.
 */
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown } from "@earendil-works/pi-tui";
import type { MarkdownTransform } from "./render/rich-markdown.ts";
import { state } from "./state.ts";

export type RichFactory = (text: string, paddingX: number, streaming: boolean, transform: MarkdownTransform | undefined) => Component;

const PATCH = Symbol.for("pi-streaming-preview.assistant-patch");
const PATCH_VERSION = 1;

interface PatchRecord {
	version: number;
	original: (this: AssistantMessageComponent, message: unknown, isStreaming?: boolean) => void;
	factory: RichFactory;
}

type PatchedPrototype = AssistantMessageComponent & { [PATCH]?: PatchRecord };

function swapChildren(component: AssistantMessageComponent, factory: RichFactory): void {
	const children = component.contentContainer?.children;
	if (!Array.isArray(children)) return;
	for (let i = 0; i < children.length; i++) {
		if (!(children[i] instanceof Markdown)) continue;
		// Markdown keeps these private; they are plain fields at runtime.
		const child = children[i] as unknown as { text?: unknown; paddingX?: number; options?: { transform?: MarkdownTransform } };
		const text = child.text;
		if (typeof text !== "string") continue;
		children[i] = factory(text, child.paddingX ?? 1, component.isStreaming, child.options?.transform);
	}
}

export function applyPatch(factory: RichFactory): void {
	const proto = AssistantMessageComponent.prototype as PatchedPrototype;
	const existing = proto[PATCH];
	if (existing && existing.version === PATCH_VERSION) {
		existing.factory = factory;
		return;
	}
	if (existing) removePatch();
	const record: PatchRecord = { version: PATCH_VERSION, original: proto.updateContent, factory };
	proto.updateContent = function patchedUpdateContent(this: AssistantMessageComponent, message: unknown, isStreaming?: boolean) {
		record.original.call(this, message, isStreaming);
		if (!state.enabled) return;
		try {
			swapChildren(this, record.factory);
		} catch {
			// Never break pi's own rendering: keep the native children.
		}
	};
	proto[PATCH] = record;
}

export function removePatch(): void {
	const proto = AssistantMessageComponent.prototype as PatchedPrototype;
	const record = proto[PATCH];
	if (!record) return;
	proto.updateContent = record.original;
	delete proto[PATCH];
}

export function isPatched(): boolean {
	return Boolean((AssistantMessageComponent.prototype as PatchedPrototype)[PATCH]);
}
