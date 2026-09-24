/**
 * pi-better-render — streaming-first rich Markdown, code and math for pi's TUI.
 *
 * Display-only by construction: assistant messages are rendered by swapping
 * pi's Markdown component (see patch.ts); message content, the session file
 * and the LLM context always keep the original Markdown/LaTeX. A `context`
 * hook additionally strips any terminal image artifacts before each request.
 */
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { createMathRenderer, imagesAvailable, mathStats, clearFormulaCache } from "./math/formula.ts";
import { deleteImages, installFrameHook } from "./math/kitty.ts";
import { loadMathJax, mathjaxError, mathjaxReady } from "./math/mathjax.ts";
import { detectTexBackend } from "./math/tex-backend.ts";
import { applyPatch, removePatch } from "./patch.ts";
import { clearLexCache } from "./render/lexer.ts";
import { cacheStats, clearBlockCache, RichMarkdown } from "./render/rich-markdown.ts";
import { containsRenderArtifacts, sanitizeMessages } from "./sanitize.ts";
import { bumpVersion, type MathMode, setRenderRequester, state } from "./state.ts";
import { createStyle, plainStyle, type Style } from "./style.ts";

let ui: ExtensionContext["ui"] | undefined;
let tui: { requestRender?: () => void; invalidate?: () => void; terminal?: { write(data: string): void } } | undefined;
let uninstallFrameHook: (() => void) | undefined;

function currentStyle(): Style {
	const theme = ui?.theme;
	if (!theme) return plainStyle();
	let highlight: Style["highlight"] = () => undefined;
	try {
		const md = getMarkdownTheme();
		if (md.highlightCode) highlight = (code, lang) => md.highlightCode!(code, lang);
	} catch {
		// no highlighting available
	}
	return createStyle(theme, highlight);
}

let lastStyle: Style = plainStyle();
const math = createMathRenderer(() => lastStyle.mathColor);

/** Re-render every message (after a mode switch, theme change or MathJax finishing to load). */
function refreshAll(): void {
	bumpVersion();
	try {
		tui?.invalidate?.();
		tui?.requestRender?.();
	} catch {
		// TUI gone (shutdown)
	}
}

/** Grab pi's TUI instance through a widget factory, then remove the widget again. */
function captureTui(ctx: ExtensionContext): void {
	const key = "pi-better-render:probe";
	try {
		ctx.ui.setWidget(key, (instance) => {
			tui = instance;
			return { render: () => [], invalidate() {} };
		});
		ctx.ui.setWidget(key, undefined);
	} catch {
		tui = undefined;
	}
	setRenderRequester(() => tui?.requestRender?.());
	// Send formula images along with the frames that display them (and again after a full clear).
	uninstallFrameHook?.();
	uninstallFrameHook = tui?.terminal && typeof tui.terminal.write === "function" ? installFrameHook(tui.terminal) : undefined;
}

/** Forget everything rendered: the next frames re-rasterize and re-send what is visible. */
function dropCaches(): void {
	clearBlockCache();
	clearLexCache();
	clearFormulaCache();
	deleteImages();
}

function debugLog(line: string): void {
	if (!state.debug) return;
	try {
		appendFileSync(join(homedir(), ".pi", "agent", "better-render-debug.log"), `[${new Date().toISOString()}] ${line}\n`);
	} catch {
		// ignore
	}
}

function statusText(): string {
	const tex = detectTexBackend();
	const lookups = cacheStats.hits + cacheStats.misses;
	const avg = mathStats.rendered > 0 ? (mathStats.totalMs / mathStats.rendered).toFixed(1) : "–";
	return [
		`rich markdown: ${state.enabled ? "on" : "off"}   math: ${state.math}   line numbers: ${state.lineNumbers ? "on" : "off"}`,
		`math engine: ${mathjaxReady() ? "MathJax + resvg" : mathjaxError() ? `unavailable (${mathjaxError()})` : "loading…"}`,
		`TeX fallback: ${tex ? tex.name : "none"}   images: ${imagesAvailable() ? "kitty placeholders" : "unavailable (Unicode fallback)"}`,
		`formulas: ${mathStats.rendered} rendered (avg ${avg} ms), ${mathStats.texRendered} via TeX, ${mathStats.failed} failed`,
		`block cache: ${lookups ? Math.round((cacheStats.hits / lookups) * 100) : 0}% hits of ${lookups}`,
	].join("\n");
}

const COMMANDS = [
	{ value: "status", label: "status", description: "Show renderer status" },
	{ value: "on", label: "on", description: "Use rich rendering for assistant messages" },
	{ value: "off", label: "off", description: "Restore pi's built-in Markdown rendering" },
	{ value: "math:streaming", label: "math:streaming", description: "Render formulas as images while streaming" },
	{ value: "math:final", label: "math:final", description: "Render formulas as images after the message ends" },
	{ value: "math:off", label: "math:off", description: "Never render formulas as images" },
	{ value: "lines", label: "lines", description: "Toggle code block line numbers" },
	{ value: "clear-cache", label: "clear-cache", description: "Drop cached renders and terminal images" },
];

export default function piBetterRender(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ui = ctx.ui;
		lastStyle = currentStyle();
		captureTui(ctx);
		applyPatch((text, paddingX, streaming, transform) => {
			lastStyle = currentStyle();
			return new RichMarkdown(text, { style: lastStyle, math, streaming, paddingX, transform });
		});
		refreshAll();
		void loadMathJax().then((ok) => {
			debugLog(ok ? "MathJax loaded" : `MathJax unavailable: ${mathjaxError()}`);
			if (ok) refreshAll();
		});
	});

	pi.on("session_shutdown", () => {
		removePatch();
		uninstallFrameHook?.();
		uninstallFrameHook = undefined;
		dropCaches();
		setRenderRequester(undefined);
		tui = undefined;
		ui = undefined;
	});

	// Safety net: the model must only ever see the original Markdown/LaTeX.
	pi.on("context", (event) => {
		const messages = event?.messages;
		if (!Array.isArray(messages)) return undefined;
		const result = sanitizeMessages(messages);
		if (state.debug) {
			const dirty = messages.filter((m: any) => containsRenderArtifacts(JSON.stringify(m.content ?? ""))).length;
			debugLog(`context: ${messages.length} messages, ${dirty} with render artifacts, ${result?.cleaned ?? 0} cleaned`);
		}
		return result ? { messages: result.messages } : undefined;
	});

	pi.registerCommand("better-render", {
		description: "Rich Markdown / math rendering: status | on | off | math:streaming|final|off | lines | clear-cache",
		getArgumentCompletions: (prefix) => COMMANDS.filter((c) => c.value.startsWith(prefix.trim())),
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "" || arg === "status") {
				ctx.ui.notify(statusText(), "info");
				return;
			}
			if (arg === "on" || arg === "off") {
				state.enabled = arg === "on";
			} else if (arg.startsWith("math:")) {
				const mode = arg.slice(5) as MathMode;
				if (!["streaming", "final", "off"].includes(mode)) {
					ctx.ui.notify(`Unknown math mode "${mode}"`, "error");
					return;
				}
				state.math = mode;
			} else if (arg === "lines") {
				state.lineNumbers = !state.lineNumbers;
			} else if (arg === "clear-cache") {
				dropCaches();
			} else {
				ctx.ui.notify(`Unknown argument "${arg}". Try: ${COMMANDS.map((c) => c.value).join(", ")}`, "error");
				return;
			}
			refreshAll();
			ctx.ui.notify(statusText(), "info");
		},
	});
}
