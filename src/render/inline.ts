import { hyperlink, renderLatex } from "@earendil-works/pi-tui";
import type { RenderContext } from "./context.ts";
import { decodeEntities, plainText } from "./util.ts";

/** Unicode approximation used while images are unavailable. */
export function latexFallback(tex: string, display = false): string {
	try {
		const rendered = renderLatex(tex, { display });
		if (rendered !== undefined) return rendered;
	} catch {
		// fall through to the raw source
	}
	return tex;
}

/** Render inline tokens to a single styled string (may contain "\n" from hard breaks). */
export function renderInline(tokens: any[] | undefined, ctx: RenderContext): string {
	if (!tokens) return "";
	let out = "";
	for (const token of tokens) out += renderInlineToken(token, ctx);
	return out;
}

function text(value: string, ctx: RenderContext): string {
	const decoded = decodeEntities(value);
	return ctx.textStyle ? ctx.textStyle(decoded) : decoded;
}

function renderInlineToken(token: any, ctx: RenderContext): string {
	const { style } = ctx;
	switch (token.type) {
		case "text":
			return token.tokens ? renderInline(token.tokens, ctx) : text(token.text, ctx);
		case "escape":
			return text(token.text, ctx);
		case "strong":
			return style.bold(renderInline(token.tokens, ctx));
		case "em":
			return style.italic(renderInline(token.tokens, ctx));
		case "del":
			return style.strike(renderInline(token.tokens, ctx));
		case "codespan":
			return style.fg("mdCode", decodeEntities(token.text));
		case "br":
			return "\n";
		case "link": {
			const label = renderInline(token.tokens, ctx) || token.href;
			const styled = style.fg("mdLink", style.underline(label));
			if (!token.href || token.href.startsWith("#")) return styled;
			const shown = plainText(token.tokens);
			const url = shown === token.href || `mailto:${shown}` === token.href ? "" : style.fg("mdLinkUrl", ` ‹${token.href}›`);
			return hyperlink(styled, token.href) + (shown.length > 0 && token.href.length <= 60 ? url : "");
		}
		case "image":
			return style.fg("muted", `[image: ${token.text || token.href}]`);
		case "html":
			return style.fg("muted", token.text ?? token.raw);
		case "inlineMath": {
			const image = ctx.math.inline(token.text, token.display, ctx.streaming);
			if (image) return image;
			return style.italic(style.fg("mdCode", latexFallback(token.text)));
		}
		case "checkbox":
			return "";
		default:
			return text(token.raw ?? token.text ?? "", ctx);
	}
}
