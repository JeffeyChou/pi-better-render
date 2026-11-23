/**
 * Install the real pi tarball into an empty folder and render with it.
 *
 *   npm pack → unpack → npm install --omit=dev (no repo, no devDependencies)
 *   + @earendil-works/pi-tui, which pi itself provides at run time
 *   → load the shipped src/pi/math-backend.ts and src/core, render a formula
 *     (from the vendored MathJax bundle) and a CJK table.
 *
 * `pi install` itself is exercised by hand and by better-render's tests; this
 * proves the tarball carries everything the extension needs to run.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "pi-better-render-tarball-"));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });

try {
	run("npm", ["pack", "--ignore-scripts", "--pack-destination", work], root);
	const tarball = readdirSync(work).find((f) => f.endsWith(".tgz"));
	run("tar", ["-xzf", join(work, tarball), "-C", work]);
	const pkg = join(work, "package");
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	run("npm", ["install", "--omit=dev", "--omit=peer", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], pkg);
	// What pi provides to its extensions.
	run("npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", `@earendil-works/pi-tui@${manifest.devDependencies["@earendil-works/pi-tui"]}`], pkg);

	const at = (path) => JSON.stringify(pathToFileURL(join(pkg, path)).href);
	const check = join(work, "check.mts");
	writeFileSync(
		check,
		`
import assert from "node:assert/strict";
import ${at("src/pi/math-backend.ts")};
import { loadMathJaxSync, mathjaxBundled, rasterize } from ${at("src/core/math/mathjax.ts")};
import { renderMarkdown } from ${at("src/core/render/markdown.ts")};
import { noMath } from ${at("src/core/render/context.ts")};
import { plainStyle } from ${at("src/core/style.ts")};
loadMathJaxSync();
assert.equal(mathjaxBundled(), true, "MathJax should come from vendor/mathjax.cjs");
const image = rasterize({ tex: "\\\\int_0^1 x^2\\\\,dx = \\\\frac{1}{3}", display: true, color: "#ffffff", cellWidth: 9, cellHeight: 19, maxColumns: 60, maxRows: 6 });
assert.ok(image.base64.startsWith("iVBORw0KGgo") && image.rows > 1, "display formula PNG");
const glyph = rasterize({ tex: "\\\\mathfrak{g}", display: false, color: "#ffffff", cellWidth: 9, cellHeight: 19, maxColumns: 20, maxRows: 1, fitRows: true });
assert.ok(glyph.base64.startsWith("iVBORw0KGgo"), "on-demand glyph data (vendor/newcm-dynamic)");
const lines = renderMarkdown("| 方法 | 复杂度 |\\n| --- | --- |\\n| 快速排序 | O(n log n) |", 60, { style: plainStyle(), math: noMath, streaming: false });
assert.ok(lines.some((l) => l.includes("快速排序")) && lines[0].startsWith("╭"), "CJK table");
console.log("tarball renders: formula " + image.columns + "x" + image.rows + " cells, table " + lines.length + " lines");
`,
	);
	process.stdout.write(run(process.execPath, ["--import", "tsx", check], root));
	console.log(`✔ ${tarball} runs from a clean install (no repo, no devDependencies)`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
