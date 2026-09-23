/**
 * Minimal declarations for the pi host package. At runtime pi resolves this
 * import to its own already-loaded module; it is not installed locally.
 */
declare module "@earendil-works/pi-coding-agent" {
	import type { Component, MarkdownTheme } from "@earendil-works/pi-tui";

	export class AssistantMessageComponent {
		contentContainer: { children: Component[] };
		isStreaming: boolean;
		updateContent(message: unknown, isStreaming?: boolean): void;
		invalidate(): void;
	}

	export function getMarkdownTheme(): MarkdownTheme;

	export interface ExtensionUIContext {
		readonly theme: any;
		notify(message: string, type?: "info" | "warning" | "error"): void;
		setWidget(key: string, content: ((tui: any, theme: any) => Component & { dispose?(): void }) | undefined, options?: unknown): void;
		setStatus(key: string, text: string | undefined): void;
	}

	export interface ExtensionContext {
		hasUI: boolean;
		ui: ExtensionUIContext;
	}

	export interface ExtensionCommandContext extends ExtensionContext {}

	export interface ExtensionAPI {
		on(event: string, handler: (event: any, ctx: ExtensionContext) => unknown): () => void;
		registerCommand(
			name: string,
			options: {
				description?: string;
				getArgumentCompletions?: (prefix: string) => { value: string; label: string; description?: string }[] | null;
				handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
			},
		): void;
	}
}
