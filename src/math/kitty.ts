/**
 * Kitty graphics protocol with Unicode placeholders (supported by Ghostty and kitty).
 *
 * The image is transmitted as a *virtual* placement (U=1). Text lines then
 * contain U+10EEEE cells whose truecolor foreground encodes the image id and
 * whose combining diacritics encode row/column. To pi-tui these are ordinary
 * 1-column characters, so they wrap, scroll and diff like text; pi-tui's own
 * Kitty bookkeeping never sees (or deletes) them.
 *
 * Only the foreground color is used (no SGR 58 underline color for placement
 * ids): pi-tui's ANSI tracker does not understand SGR 58 and would carry its
 * R;G;B bytes into the next wrapped line as bogus attributes (e.g. 41 = red
 * background).
 *
 * Transmission is frame-driven: `installFrameHook` wraps pi's terminal writer,
 * scans every outgoing frame for placeholder ids and sends each image the
 * terminal does not have yet right before the frame data. A full clear
 * (ED 2/3, RIS), as pi does on resize, makes the terminal drop images, so it
 * resets the "sent" set and the images are re-sent with the redrawn lines.
 * Without a hook (preview script, tests) images are sent when registered.
 *
 * Diacritic table: kitty's rowcolumn-diacritics.txt (via Fadouse/pi-math, MIT).
 */
const DIACRITIC_CODE_POINTS = [
  0x305, 0x30d, 0x30e, 0x310, 0x312, 0x33d, 0x33e, 0x33f, 0x346, 0x34a, 0x34b, 0x34c,
  0x350, 0x351, 0x352, 0x357, 0x35b, 0x363, 0x364, 0x365, 0x366, 0x367, 0x368, 0x369,
  0x36a, 0x36b, 0x36c, 0x36d, 0x36e, 0x36f, 0x483, 0x484, 0x485, 0x486, 0x487, 0x592,
  0x593, 0x594, 0x595, 0x597, 0x598, 0x599, 0x59c, 0x59d, 0x59e, 0x59f, 0x5a0, 0x5a1,
  0x5a8, 0x5a9, 0x5ab, 0x5ac, 0x5af, 0x5c4, 0x610, 0x611, 0x612, 0x613, 0x614, 0x615,
  0x616, 0x617, 0x657, 0x658, 0x659, 0x65a, 0x65b, 0x65d, 0x65e, 0x6d6, 0x6d7, 0x6d8,
  0x6d9, 0x6da, 0x6db, 0x6dc, 0x6df, 0x6e0, 0x6e1, 0x6e2, 0x6e4, 0x6e7, 0x6e8, 0x6eb,
  0x6ec, 0x730, 0x732, 0x733, 0x735, 0x736, 0x73a, 0x73d, 0x73f, 0x740, 0x741, 0x743,
  0x745, 0x747, 0x749, 0x74a, 0x7eb, 0x7ec, 0x7ed, 0x7ee, 0x7ef, 0x7f0, 0x7f1, 0x7f3,
  0x816, 0x817, 0x818, 0x819, 0x81b, 0x81c, 0x81d, 0x81e, 0x81f, 0x820, 0x821, 0x822,
  0x823, 0x825, 0x826, 0x827, 0x829, 0x82a, 0x82b, 0x82c, 0x82d, 0x951, 0x953, 0x954,
  0xf82, 0xf83, 0xf86, 0xf87, 0x135d, 0x135e, 0x135f, 0x17dd, 0x193a, 0x1a17, 0x1a75, 0x1a76,
  0x1a77, 0x1a78, 0x1a79, 0x1a7a, 0x1a7b, 0x1a7c, 0x1b6b, 0x1b6d, 0x1b6e, 0x1b6f, 0x1b70, 0x1b71,
  0x1b72, 0x1b73, 0x1cd0, 0x1cd1, 0x1cd2, 0x1cda, 0x1cdb, 0x1ce0, 0x1dc0, 0x1dc1, 0x1dc3, 0x1dc4,
  0x1dc5, 0x1dc6, 0x1dc7, 0x1dc8, 0x1dc9, 0x1dcb, 0x1dcc, 0x1dd1, 0x1dd2, 0x1dd3, 0x1dd4, 0x1dd5,
  0x1dd6, 0x1dd7, 0x1dd8, 0x1dd9, 0x1dda, 0x1ddb, 0x1ddc, 0x1ddd, 0x1dde, 0x1ddf, 0x1de0, 0x1de1,
  0x1de2, 0x1de3, 0x1de4, 0x1de5, 0x1de6, 0x1dfe, 0x20d0, 0x20d1, 0x20d4, 0x20d5, 0x20d6, 0x20d7,
  0x20db, 0x20dc, 0x20e1, 0x20e7, 0x20e9, 0x20f0, 0x2cef, 0x2cf0, 0x2cf1, 0x2de0, 0x2de1, 0x2de2,
  0x2de3, 0x2de4, 0x2de5, 0x2de6, 0x2de7, 0x2de8, 0x2de9, 0x2dea, 0x2deb, 0x2dec, 0x2ded, 0x2dee,
  0x2def, 0x2df0, 0x2df1, 0x2df2, 0x2df3, 0x2df4, 0x2df5, 0x2df6, 0x2df7, 0x2df8, 0x2df9, 0x2dfa,
  0x2dfb, 0x2dfc, 0x2dfd, 0x2dfe, 0x2dff, 0xa66f, 0xa67c, 0xa67d, 0xa6f0, 0xa6f1, 0xa8e0, 0xa8e1,
  0xa8e2, 0xa8e3, 0xa8e4, 0xa8e5, 0xa8e6, 0xa8e7, 0xa8e8, 0xa8e9, 0xa8ea, 0xa8eb, 0xa8ec, 0xa8ed,
  0xa8ee, 0xa8ef, 0xa8f0, 0xa8f1, 0xaab0, 0xaab2, 0xaab3, 0xaab7, 0xaab8, 0xaabe, 0xaabf, 0xaac1,
  0xfe20, 0xfe21, 0xfe22, 0xfe23, 0xfe24, 0xfe25, 0xfe26, 0x10a0f, 0x10a38, 0x1d185, 0x1d186, 0x1d187,
  0x1d188, 0x1d189, 0x1d1aa, 0x1d1ab, 0x1d1ac, 0x1d1ad, 0x1d242, 0x1d243, 0x1d244,
] as const;

const PLACEHOLDER = String.fromCodePoint(0x10eeee);
const DIACRITICS = DIACRITIC_CODE_POINTS.map((cp) => String.fromCodePoint(cp));
export const MAX_PLACEHOLDER_CELLS = DIACRITICS.length;
const CHUNK = 4096;

/** Terminals known to implement Unicode placeholders. */
export function placeholderTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.PI_BETTER_RENDER_PLACEHOLDERS === "1") return true;
	if (env.PI_BETTER_RENDER_PLACEHOLDERS === "0") return false;
	if (env.TMUX || env.STY) return false;
	const program = env.TERM_PROGRAM?.toLowerCase() ?? "";
	const term = env.TERM?.toLowerCase() ?? "";
	return Boolean(
		env.KITTY_WINDOW_ID ||
			env.GHOSTTY_RESOURCES_DIR ||
			program === "ghostty" ||
			program === "kitty" ||
			term.includes("kitty") ||
			term.includes("ghostty"),
	);
}

function rgb(id: number): string {
	return `${(id >> 16) & 0xff};${(id >> 8) & 0xff};${id & 0xff}`;
}

export function placeholderOpen(id: number): string {
	return `\x1b[38;2;${rgb(id)}m`;
}

export const PLACEHOLDER_CLOSE = "\x1b[39m";

/** One placeholder cell (row r, column c of the image). */
export function placeholderCell(row: number, column: number): string {
	return PLACEHOLDER + DIACRITICS[row] + DIACRITICS[column];
}

/** Placeholder text for an image: one string per terminal row, `columns` cells each. */
export function placeholderRows(id: number, columns: number, rows: number): string[] {
	const out: string[] = [];
	for (let r = 0; r < rows; r++) {
		let cells = placeholderOpen(id);
		for (let c = 0; c < columns; c++) cells += placeholderCell(r, c);
		out.push(cells + PLACEHOLDER_CLOSE);
	}
	return out;
}

/** APC sequence(s) transmitting a PNG and creating a virtual placement of columns×rows cells. */
export function transmitSequence(base64Png: string, id: number, columns: number, rows: number): string {
	const params = `a=T,f=100,q=2,U=1,i=${id},c=${columns},r=${rows}`;
	if (base64Png.length <= CHUNK) return `\x1b_G${params};${base64Png}\x1b\\`;
	let out = "";
	for (let offset = 0; offset < base64Png.length; offset += CHUNK) {
		const chunk = base64Png.slice(offset, offset + CHUNK);
		const more = offset + CHUNK < base64Png.length ? 1 : 0;
		out += offset === 0 ? `\x1b_G${params},m=1;${chunk}\x1b\\` : `\x1b_Gm=${more},q=2;${chunk}\x1b\\`;
	}
	return out;
}

export function deleteSequence(id: number): string {
	return `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`;
}

interface ImageData {
	base64: string;
	columns: number;
	rows: number;
}

type Writer = (data: string) => void;

let directWriter: Writer | undefined = (data) => {
	if (process.stdout.isTTY) process.stdout.write(data);
};

/** Tests replace the writer used when no frame hook is installed (undefined drops output). */
export function setKittyWriter(fn: Writer | undefined): void {
	directWriter = fn;
}

const REGISTRY_LIMIT = 4000;
const registry = new Map<number, ImageData>();
const sent = new Set<number>();
let hooked = false;

/** Make an image known. Without a frame hook it is sent immediately. */
export function registerImage(id: number, base64: string, columns: number, rows: number): void {
	if (!registry.has(id)) {
		registry.set(id, { base64, columns, rows });
		if (registry.size > REGISTRY_LIMIT) {
			const oldest = registry.keys().next().value;
			if (oldest !== undefined) registry.delete(oldest);
		}
	}
	if (!hooked && !sent.has(id)) {
		sent.add(id);
		directWriter?.(transmitSequence(base64, id, columns, rows));
	}
}

/** The truecolor foreground closest to a placeholder cell (other SGRs, e.g. bold, may sit in between). */
const ID_IN_FRAME = /\x1b\[38;2;(\d{1,3});(\d{1,3});(\d{1,3})m(?:\x1b\[(?!38;)[\d;]*m)*\u{10EEEE}/gu;
const CLEAR = /\x1b\[[23]J|\x1bc/g;

/**
 * Transmissions a frame chunk needs, and where to insert them (after the last
 * full clear in the chunk, else at the start). Exported for tests.
 */
export function prepareFrame(chunk: string, carry = ""): { insertAt: number; transmissions: string } {
	let insertAt = 0;
	CLEAR.lastIndex = 0;
	for (let m = CLEAR.exec(chunk); m; m = CLEAR.exec(chunk)) insertAt = m.index + m[0].length;
	if (insertAt > 0) sent.clear();

	let transmissions = "";
	if (registry.size === 0) return { insertAt, transmissions };
	const text = carry + chunk;
	ID_IN_FRAME.lastIndex = 0;
	for (let m = ID_IN_FRAME.exec(text); m; m = ID_IN_FRAME.exec(text)) {
		const id = (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
		if (sent.has(id)) continue;
		const image = registry.get(id);
		if (!image) continue;
		sent.add(id);
		transmissions += transmitSequence(image.base64, id, image.columns, image.rows);
	}
	return { insertAt, transmissions };
}

interface WritableTerminal {
	write(data: string): void;
}

/** Wrap pi's terminal writer so images travel with the frames that show them. Returns an uninstaller. */
export function installFrameHook(terminal: WritableTerminal): () => void {
	const original = terminal.write;
	let carry = "";
	const hook = function (this: unknown, data: string) {
		let out = data;
		if (typeof data === "string" && data.length > 0) {
			try {
				const { insertAt, transmissions } = prepareFrame(data, carry);
				if (transmissions) out = data.slice(0, insertAt) + transmissions + data.slice(insertAt);
				// A placeholder's color sequence may straddle two writes.
				carry = data.slice(-40);
			} catch {
				out = data;
			}
		}
		return original.call(this ?? terminal, out);
	};
	terminal.write = hook;
	hooked = true;
	sent.clear(); // unknown terminal state: resend on first sight
	return () => {
		if (terminal.write === hook) terminal.write = original;
		hooked = false;
	};
}

/** Free every image this process sent (terminal side) and forget them. */
export function deleteImages(write: Writer | undefined = directWriter): void {
	let out = "";
	for (const id of sent) out += deleteSequence(id);
	sent.clear();
	registry.clear();
	if (out) write?.(out);
}

let nextId = 0x100000 + Math.floor(Math.random() * 0x600000);

/** 24-bit image ids (encoded in the placeholder's truecolor foreground). */
export function allocateId(): number {
	nextId = nextId >= 0xfffff0 ? 0x100000 : nextId + 1;
	return nextId;
}
