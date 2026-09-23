import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export { visibleWidth };

export type Align = "left" | "center" | "right";

/** Word-wrap text (which may contain ANSI and newlines) to `width` columns. */
export function wrap(text: string, width: number): string[] {
	const w = Math.max(1, width);
	const out: string[] = [];
	for (const line of text.split("\n")) {
		if (visibleWidth(line) <= w) out.push(line);
		else out.push(...wrapTextWithAnsi(line, w));
	}
	return out;
}

export function pad(text: string, width: number, align: Align = "left"): string {
	const gap = Math.max(0, width - visibleWidth(text));
	if (align === "right") return " ".repeat(gap) + text;
	if (align === "center") {
		const left = Math.floor(gap / 2);
		return " ".repeat(left) + text + " ".repeat(gap - left);
	}
	return text + " ".repeat(gap);
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

export function decodeEntities(text: string): string {
	if (!text.includes("&")) return text;
	return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
		if (body[0] === "#") {
			const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
		}
		return ENTITIES[body.toLowerCase()] ?? match;
	});
}

/** Plain text of an inline token tree (used for callout detection, link labels). */
export function plainText(tokens: any[] | undefined): string {
	if (!tokens) return "";
	return tokens
		.map((t) => (t.tokens ? plainText(t.tokens) : decodeEntities(t.text ?? t.raw ?? "")))
		.join("");
}
