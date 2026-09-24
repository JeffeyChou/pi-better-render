/**
 * Fonts for text MathJax leaves as <text> (\text{…} with CJK and other
 * characters outside its math fonts), chosen per script.
 *
 * A system font is preferred. When a formula needs a script no system font
 * covers (typically a Linux server or container without Noto CJK), Noto Sans
 * SC (Han, kana) or KR (Hangul) is downloaded once into
 * ~/.pi/agent/better-render/fonts, pinned by SHA-256. Until it arrives the
 * formula uses the Unicode fallback (the terminal draws CJK with its own
 * font); then it re-renders as an image.
 * PI_BETTER_RENDER_FONT_DOWNLOAD=0 disables the download.
 *
 * Loading every system font costs ~100 ms per image; a few files cost ~10 ms,
 * so only the fonts a formula needs are passed to resvg.
 */
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { bumpVersion, requestRender } from "../state.ts";

export type Script = "han" | "hangul";

export interface FontSpec {
	file: string;
	url: string;
	sha256: string;
	bytes: number;
}

const SCRIPTS: Record<Script, RegExp> = {
	// CJK ideographs, kana, CJK punctuation, fullwidth forms
	han: /[\u2e80-\u2fdf\u3000-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/,
	hangul: /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/,
};

const SYSTEM_FONTS: Record<Script, string[]> = {
	han: [
		"/System/Library/Fonts/Hiragino Sans GB.ttc",
		"/System/Library/Fonts/STHeiti Medium.ttc",
		"/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
		"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
		"/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
		"/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
		"/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
		"/usr/share/fonts/wenquanyi/wqy-microhei/wqy-microhei.ttc",
		"C:\\Windows\\Fonts\\msyh.ttc",
	],
	hangul: [
		"/System/Library/Fonts/AppleSDGothicNeo.ttc",
		"/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
		"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
		"/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
		"/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
		"/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
		"C:\\Windows\\Fonts\\malgun.ttf",
	],
};

/** Other characters outside MathJax's fonts (Cyrillic in \text, symbols). */
const GENERIC_FONTS = [
	"/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
	"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
	"/usr/share/fonts/TTF/DejaVuSans.ttf",
	"C:\\Windows\\Fonts\\arial.ttf",
];

/** Noto Sans SC/KR Regular (SIL OFL 1.1) from the @expo-google-fonts packages, via jsDelivr. */
const DOWNLOADS: Record<Script, FontSpec> = {
	han: {
		file: "NotoSansSC-Regular.ttf",
		url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-sc@0.4.3/400Regular/NotoSansSC_400Regular.ttf",
		sha256: "d45f67f0a7c0ca3f256950777ce6a61cc7ce5f9696d02900cbbaac25f8aa7d16",
		bytes: 10_559_284,
	},
	hangul: {
		file: "NotoSansKR-Regular.ttf",
		url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-kr@0.4.3/400Regular/NotoSansKR_400Regular.ttf",
		sha256: "8cbc9b353bb9ce848fd69bb6a507319dfacc659cf5fd643db5d88f3c4970e1dd",
		bytes: 6_185_868,
	},
};

/** A formula needs a font that is still downloading: show the text fallback for now. */
export class FontPendingError extends Error {}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

interface Config {
	system: Record<Script, string[]>;
	generic: string[];
	downloads: Record<Script, FontSpec>;
	dir: string;
	allowDownload: boolean;
	fetch: Fetch;
}

function defaultConfig(): Config {
	return {
		system: SYSTEM_FONTS,
		generic: GENERIC_FONTS,
		downloads: DOWNLOADS,
		dir: process.env.PI_BETTER_RENDER_FONTS_DIR || join(homedir(), ".pi", "agent", "better-render", "fonts"),
		allowDownload: process.env.PI_BETTER_RENDER_FONT_DOWNLOAD !== "0",
		fetch: (url, init) => fetch(url, init),
	};
}

let config = defaultConfig();
const resolved = new Map<Script, string | undefined>();
const downloads = new Map<Script, "pending" | Error>();
let generic: string[] | undefined;

/** Tests: replace font locations, download source or target directory. */
export function configureTextFonts(overrides: Partial<Config> = {}): void {
	config = { ...defaultConfig(), ...overrides };
	resolved.clear();
	downloads.clear();
	generic = undefined;
}

export function scriptsIn(text: string): Script[] {
	return (Object.keys(SCRIPTS) as Script[]).filter((s) => SCRIPTS[s].test(text));
}

function downloadedPath(script: Script): string | undefined {
	const spec = config.downloads[script];
	const path = join(config.dir, spec.file);
	try {
		return statSync(path).size === spec.bytes ? path : undefined;
	} catch {
		return undefined;
	}
}

/** A system or previously downloaded font for the script, if any. */
function fontFor(script: Script): string | undefined {
	if (!resolved.has(script)) resolved.set(script, config.system[script].find((file) => existsSync(file)) ?? downloadedPath(script));
	return resolved.get(script);
}

async function download(script: Script): Promise<void> {
	const spec = config.downloads[script];
	const response = await config.fetch(spec.url, { signal: AbortSignal.timeout(180_000) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const data = Buffer.from(await response.arrayBuffer());
	const hash = createHash("sha256").update(data).digest("hex");
	if (hash !== spec.sha256 || data.length !== spec.bytes) throw new Error(`${spec.file}: checksum mismatch`);
	await mkdir(config.dir, { recursive: true });
	const target = join(config.dir, spec.file);
	const partial = `${target}.${process.pid}.part`;
	await writeFile(partial, data);
	await rename(partial, target);
}

function startDownload(script: Script): void {
	if (downloads.has(script)) return;
	downloads.set(script, "pending");
	download(script).then(
		() => {
			downloads.delete(script);
			resolved.delete(script);
			bumpVersion();
			requestRender();
		},
		(error) => {
			downloads.set(script, error instanceof Error ? error : new Error(String(error)));
			bumpVersion();
			requestRender();
		},
	);
}

/**
 * resvg font options for an SVG with <text>. Throws FontPendingError while a
 * font the text needs is being downloaded.
 */
export function textFontOptions(svg: string): { loadSystemFonts: boolean; fontFiles?: string[] } {
	const files: string[] = [];
	const pending: string[] = [];
	for (const script of scriptsIn(svg)) {
		const file = fontFor(script);
		if (file) {
			files.push(file);
			continue;
		}
		if (!config.allowDownload || downloads.get(script) instanceof Error) continue;
		startDownload(script);
		pending.push(config.downloads[script].file);
	}
	if (pending.length > 0) throw new FontPendingError(`downloading ${pending.join(", ")}`);
	generic ??= config.generic.filter((file) => existsSync(file)).slice(0, 1);
	for (const file of generic) if (!files.includes(file)) files.push(file);
	return files.length > 0 ? { loadSystemFonts: false, fontFiles: files } : { loadSystemFonts: true };
}

/** One line per script for /better-render status. */
export function textFontStatus(): string {
	return (Object.keys(SCRIPTS) as Script[])
		.map((script) => {
			const label = script === "han" ? "CJK" : "Hangul";
			const state = downloads.get(script);
			if (state === "pending") return `${label}: downloading`;
			if (state instanceof Error) return `${label}: download failed (${state.message})`;
			const file = fontFor(script);
			if (!file) return `${label}: none (${config.allowDownload ? "downloads when needed" : "download disabled"})`;
			return `${label}: ${basename(file)}`;
		})
		.join("   ");
}
