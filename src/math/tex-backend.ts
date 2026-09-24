/**
 * Optional fallback for formulas MathJax cannot typeset (unknown macros,
 * packages): a real TeX engine in a child process, asynchronously.
 *
 *   latex + dvipng        (TeX Live / BasicTeX: tlmgr install dvipng preview)
 *   tectonic + pdftocairo (tectonic ≈ 0.7 s per formula, still fine as a fallback)
 *
 * Hardening: no shell escape, paranoid file access, hard timeout, temp dir
 * removed afterwards.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface TexBackend {
	readonly name: string;
	/** PNG bytes of the formula, transparent background, colored `color` (#rrggbb). */
	render(tex: string, display: boolean, color: string, dpi: number): Promise<Buffer>;
}

const EXTRA_PATHS = ["/Library/TeX/texbin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/texbin"];
const TIMEOUT_MS = 15_000;

function which(name: string): string | undefined {
	const dirs = [...(process.env.PATH ?? "").split(delimiter), ...EXTRA_PATHS];
	for (const dir of dirs) {
		if (!dir) continue;
		const candidate = join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

function run(file: string, args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{ cwd, timeout: TIMEOUT_MS, env: { ...process.env, openin_any: "p", openout_any: "p", shell_escape: "f" } },
			(error, _stdout, stderr) => (error ? reject(new Error(`${file}: ${String(stderr || error.message).slice(-400)}`)) : resolve()),
		);
	});
}

function isEnvironment(tex: string): boolean {
	return /^\\begin\{/.test(tex.trim());
}

function body(tex: string, display: boolean): string {
	if (isEnvironment(tex)) return tex;
	return display ? `$\\displaystyle ${tex}$` : `$${tex}$`;
}

const PREAMBLE = String.raw`\usepackage{amsmath,amssymb,amsfonts}
\IfFileExists{bm.sty}{\usepackage{bm}}{}
\IfFileExists{mathtools.sty}{\usepackage{mathtools}}{}
\pagestyle{empty}`;

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "pi-better-render-"));
	try {
		return await fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function latexBackend(latex: string, dvipng: string): TexBackend {
	return {
		name: "latex+dvipng",
		render: (tex, display, color, dpi) =>
			withTempDir(async (dir) => {
				const doc = String.raw`\documentclass[12pt]{article}
${PREAMBLE}
\usepackage[active,tightpage]{preview}
\begin{document}
\begin{preview}${isEnvironment(tex) ? `\\begin{minipage}{0.9\\textwidth}${tex}\\end{minipage}` : body(tex, display)}\end{preview}
\end{document}
`;
				writeFileSync(join(dir, "f.tex"), doc);
				await run(latex, ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "f.tex"], dir);
				const [r, g, b] = [1, 3, 5].map((i) => (parseInt(color.slice(i, i + 2), 16) / 255).toFixed(3));
				await run(dvipng, ["-q", "-D", String(Math.round(dpi)), "-T", "tight", "-bg", "Transparent", "-fg", `rgb ${r} ${g} ${b}`, "-z", "6", "-o", "f.png", "f.dvi"], dir);
				return readFileSync(join(dir, "f.png"));
			}),
	};
}

function tectonicBackend(tectonic: string, pdftocairo: string): TexBackend {
	return {
		name: "tectonic",
		render: (tex, display, color, dpi) =>
			withTempDir(async (dir) => {
				const doc = String.raw`\documentclass[varwidth,border=1pt,12pt]{standalone}
${PREAMBLE}
\usepackage{xcolor}
\begin{document}
\color[HTML]{${color.slice(1).toUpperCase()}}${body(tex, display)}
\end{document}
`;
				writeFileSync(join(dir, "f.tex"), doc);
				await run(tectonic, ["--untrusted", "--only-cached", "-r", "0", "f.tex"], dir).catch(() =>
					// --only-cached fails on a cold bundle cache; retry allowing downloads.
					run(tectonic, ["--untrusted", "-r", "0", "f.tex"], dir),
				);
				await run(pdftocairo, ["-png", "-transparent", "-singlefile", "-r", String(Math.round(dpi)), "f.pdf", "f"], dir);
				return readFileSync(join(dir, "f.png"));
			}),
	};
}

let detected: TexBackend | null | undefined;

/** Find a TeX toolchain (cached). Set PI_BETTER_RENDER_TEX=off to disable, =tectonic/latex to force. */
export function detectTexBackend(): TexBackend | undefined {
	if (detected !== undefined) return detected ?? undefined;
	const pref = process.env.PI_BETTER_RENDER_TEX?.toLowerCase();
	detected = null;
	if (pref === "off") return undefined;
	const latex = which("latex");
	const dvipng = which("dvipng");
	const tectonic = which("tectonic");
	const pdftocairo = which("pdftocairo");
	if (pref !== "tectonic" && latex && dvipng) detected = latexBackend(latex, dvipng);
	else if (pref !== "latex" && tectonic && pdftocairo) detected = tectonicBackend(tectonic, pdftocairo);
	return detected ?? undefined;
}
