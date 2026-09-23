import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export { visibleWidth };

export type Align = "left" | "center" | "right";

/** An inline image: `\x1b[38;2;R;G;Bm` + placeholder cells + `\x1b[39m` (see math/kitty.ts). */
const IMAGE_RUN = /(\x1b\[38;2;\d{1,3};\d{1,3};\d{1,3}m)((?:\u{10EEEE}\p{M}*)+)\x1b\[39m/gu;
const IMAGE_CELL = /\u{10EEEE}\p{M}*/gu;
/** Sentinels: one Supplementary-PUA-A code point per image run, repeated once per cell. */
const SENTINEL_BASE = 0xf0000;
const SENTINEL_RUN = /[\u{F0000}-\u{FFFFD}]+/gu;

/**
 * Word-wrap text (which may contain ANSI, inline image placeholders and
 * newlines) to `width` columns.
 *
 * Inline images are swapped for plain 1-column sentinel characters while
 * wrapping: pi-tui's wrapper then treats each image as an ordinary word and
 * never has to track its escape sequences. Afterwards every sentinel run is
 * turned back into the matching placeholder cells; an image split across lines
 * keeps its correct columns on each side, because each cell encodes its column.
 */
export function wrap(text: string, width: number): string[] {
	const w = Math.max(1, width);
	const images: { open: string; cells: string[]; used: number }[] = [];
	const protectedText = text.includes("\u{10EEEE}")
		? text.replace(IMAGE_RUN, (_m, open: string, cells: string) => {
				const list = cells.match(IMAGE_CELL) ?? [];
				images.push({ open, cells: list, used: 0 });
				return String.fromCodePoint(SENTINEL_BASE + images.length - 1).repeat(list.length);
			})
		: text;

	const out: string[] = [];
	for (const line of protectedText.split("\n")) {
		if (visibleWidth(line) <= w) out.push(line);
		else out.push(...wrapTextWithAnsi(line, w));
	}
	if (images.length === 0) return out;

	return out.map((line) =>
		line.replace(SENTINEL_RUN, (run) => {
			let restored = "";
			for (const [char, count] of runs(run)) {
				const image = images[char.codePointAt(0)! - SENTINEL_BASE];
				if (!image) {
					restored += char.repeat(count);
					continue;
				}
				restored += image.open + image.cells.slice(image.used, image.used + count).join("") + "\x1b[39m";
				image.used += count;
			}
			return restored;
		}),
	);
}

/** Split a string into runs of the same code point. */
function* runs(text: string): Generator<[string, number]> {
	let current = "";
	let count = 0;
	for (const char of text) {
		if (char === current) count++;
		else {
			if (count > 0) yield [current, count];
			current = char;
			count = 1;
		}
	}
	if (count > 0) yield [current, count];
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
