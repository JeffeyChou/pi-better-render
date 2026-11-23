/**
 * Rendered terminal lines → plain-data rows for element-based hosts.
 *
 * Each line becomes segments: styled text runs (the SGR codes turned back
 * into props) and images (runs of marker characters, see math.ts). A display
 * formula spans several consecutive lines at the same column; those lines are
 * joined into one band so the host can draw a single multi-row picture with
 * the text left and right of it (list indent, quote bar) stacked beside it.
 */
import { THEME_CODE_BASE, THEME_KEYS } from "./style.ts";
import { type FormulaImage, type ImageRegistry, isMark } from "./math.ts";

export interface TextRun {
	text: string;
	color?: string;
	bold?: true;
	dim?: true;
	italic?: true;
	underline?: true;
	strikethrough?: true;
}

export type Segment =
	| { kind: "text"; runs: TextRun[] }
	| { kind: "image"; image: FormulaImage; id: number; columns: number; rows: number };

/** One terminal row, or a band of rows around one multi-row image. */
export type Row =
	| { kind: "line"; segments: Segment[] }
	| { kind: "band"; left: Segment[][]; image: Extract<Segment, { kind: "image" }>; right: Segment[][] };

interface StyleState {
	color?: string;
	bold?: true;
	dim?: true;
	italic?: true;
	underline?: true;
	strikethrough?: true;
}

const HEX = (n: number) => n.toString(16).padStart(2, "0");

function applySgr(state: StyleState, params: string): StyleState {
	const next = { ...state };
	const codes = params === "" ? [0] : params.split(";").map((p) => Number(p) || 0);
	for (let i = 0; i < codes.length; i++) {
		const code = codes[i]!;
		if (code === 0) {
			for (const key of Object.keys(next)) delete next[key as keyof StyleState];
		} else if (code === 1) next.bold = true;
		else if (code === 2) next.dim = true;
		else if (code === 3) next.italic = true;
		else if (code === 4) next.underline = true;
		else if (code === 9) next.strikethrough = true;
		else if (code === 22) {
			delete next.bold;
			delete next.dim;
		} else if (code === 23) delete next.italic;
		else if (code === 24) delete next.underline;
		else if (code === 29) delete next.strikethrough;
		else if (code === 39) delete next.color;
		else if (code === 38 && codes[i + 1] === 5) {
			const n = codes[i + 2] ?? 0;
			const key = THEME_KEYS[n - THEME_CODE_BASE];
			if (key) next.color = key;
			i += 2;
		} else if (code === 38 && codes[i + 1] === 2) {
			next.color = `#${HEX(codes[i + 2] ?? 0)}${HEX(codes[i + 3] ?? 0)}${HEX(codes[i + 4] ?? 0)}`;
			i += 4;
		} else if (code === 48 && (codes[i + 1] === 5 || codes[i + 1] === 2)) {
			i += codes[i + 1] === 5 ? 2 : 4; // backgrounds are not drawn
		}
	}
	return next;
}

function sameStyle(a: StyleState, b: StyleState): boolean {
	return a.color === b.color && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic && a.underline === b.underline && a.strikethrough === b.strikethrough;
}

interface Mark {
	id: number;
	row: number;
	/** Column where the run starts. */
	column: number;
	count: number;
}

/** Split one line into text runs and marker runs; also report each marker run's position. */
function parseLine(line: string, registry: ImageRegistry): { segments: Segment[]; marks: Mark[] } {
	const segments: Segment[] = [];
	const marks: Mark[] = [];
	let state: StyleState = {};
	let runs: TextRun[] = [];
	let text = "";
	let textStyle: StyleState = {};
	let column = 0;

	const flushText = () => {
		if (text) runs.push({ text, ...textStyle });
		text = "";
	};
	const flushRuns = () => {
		flushText();
		if (runs.length > 0) segments.push({ kind: "text", runs });
		runs = [];
	};
	const append = (chars: string) => {
		if (!sameStyle(state, textStyle)) {
			flushText();
			textStyle = { ...state };
		}
		text += chars;
	};

	let i = 0;
	while (i < line.length) {
		const ch = line[i]!;
		if (ch === "\x1b") {
			const next = line[i + 1];
			if (next === "[") {
				const end = /[\x40-\x7e]/.exec(line.slice(i + 2));
				if (!end) break;
				const stop = i + 2 + end.index;
				if (line[stop] === "m") state = applySgr(state, line.slice(i + 2, stop));
				i = stop + 1;
				continue;
			}
			if (next === "]" || next === "_" || next === "P") {
				// OSC (hyperlinks) / APC / DCS: dropped; the link text stays.
				const bel = line.indexOf("\x07", i + 2);
				const st = line.indexOf("\x1b\\", i + 2);
				const ends = [bel >= 0 ? bel + 1 : Infinity, st >= 0 ? st + 2 : Infinity];
				const stop = Math.min(...ends);
				i = stop === Infinity ? line.length : stop;
				continue;
			}
			i += 2;
			continue;
		}
		const cp = line.codePointAt(i)!;
		const size = cp > 0xffff ? 2 : 1;
		const info = isMark(cp) ? registry.marks.get(cp) : undefined;
		const image = info ? registry.images.get(info.id) : undefined;
		if (info && image) {
			let count = 0;
			while (line.codePointAt(i) === cp) {
				count++;
				i += size;
			}
			flushRuns();
			marks.push({ id: info.id, row: info.row, column, count });
			segments.push({ kind: "image", image, id: info.id, columns: count, rows: 1 });
			column += count;
			continue;
		}
		append(line.slice(i, i + size));
		column += 1; // only used for marker columns; wide text before an image is rare and harmless
		i += size;
	}
	flushRuns();
	return { segments, marks };
}

/** The plain text of a segment list. */
export function segmentText(segments: Segment[]): string {
	return segments.map((s) => (s.kind === "text" ? s.runs.map((r) => r.text).join("") : "")).join("");
}

/** Lay out rendered lines as rows; multi-row images become bands. */
export function layoutLines(lines: string[], registry: ImageRegistry): Row[] {
	const parsed = lines.map((line) => parseLine(line, registry));
	const rows: Row[] = [];
	for (let i = 0; i < parsed.length; i++) {
		const { segments, marks } = parsed[i]!;
		const first = marks.find((m) => m.row === 0 && (registry.images.get(m.id)?.rows ?? 1) > 1);
		if (first) {
			const height = registry.images.get(first.id)!.rows;
			const band = parsed.slice(i, i + height);
			const complete =
				band.length === height &&
				band.every((p, r) => p.marks.some((m) => m.id === first.id && m.row === r && m.column === first.column && m.count === first.count));
			if (complete) {
				const left: Segment[][] = [];
				const right: Segment[][] = [];
				let image: Extract<Segment, { kind: "image" }> | undefined;
				for (const p of band) {
					const at = p.segments.findIndex((s) => s.kind === "image" && s.id === first.id);
					left.push(p.segments.slice(0, at));
					right.push(p.segments.slice(at + 1));
					image ??= { ...(p.segments[at] as Extract<Segment, { kind: "image" }>), rows: height };
				}
				rows.push({ kind: "band", left, image: image!, right });
				i += height - 1;
				continue;
			}
		}
		rows.push({ kind: "line", segments });
	}
	return rows;
}
