/**
 * Check what each npm package would publish (`npm pack --dry-run --json`):
 *
 *   pi-better-render  the pi adapter, the shared core and the vendored MathJax;
 *                     no Claude Code plugin, no installer, no tests or tools
 *   better-render     the installer alone (bin + src), with no dependencies
 *
 * and that the pi package's entry and runtime assets resolve inside the
 * tarball: every relative import of every shipped module points at a shipped
 * file, and nothing it needs at run time is a devDependency.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const fail = (message) => problems.push(message);

function packList(dir) {
	const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: dir, encoding: "utf8" });
	const [info] = JSON.parse(out);
	return { info, files: info.files.map((f) => f.path) };
}

// pi-better-render
{
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const { info, files } = packList(root);
	const has = (path) => files.includes(path);
	for (const entry of manifest.pi.extensions) if (!has(normalize(entry))) fail(`pi: extension entry ${entry} is not in the tarball`);
	if (!has(normalize(manifest.main))) fail(`pi: main ${manifest.main} is not in the tarball`);
	for (const asset of ["vendor/mathjax.cjs", "vendor/LICENSE", "vendor/newcm-dynamic/latin.cjs", "LICENSE", "README.md", "package.json"]) {
		if (!has(asset)) fail(`pi: runtime asset ${asset} is missing`);
	}
	for (const file of files) {
		if (/^(plugins|packages|test|tools|assets|\.claude-plugin|\.github)\//.test(file) || file.startsWith("src/claude/")) fail(`pi: ${file} must not be published`);
	}
	// Relative imports of shipped modules must stay inside the tarball.
	const runtimeDeps = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
	for (const file of files.filter((f) => /\.(ts|cjs|mjs|js)$/.test(f) && !f.endsWith(".d.ts") && !f.endsWith(".d.cts"))) {
		const source = readFileSync(join(root, file), "utf8");
		const specs = [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^"'`]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|require\(["']([^"']+)["']\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
		for (const spec of specs) {
			if (spec.startsWith(".")) {
				const target = normalize(join(dirname(file), spec));
				// mathjax.ts's dev fallback (mathjax-lib.cjs requiring @mathjax/*) only runs without vendor/.
				if (!has(target)) fail(`pi: ${file} imports ${spec}, which is not in the tarball`);
			} else if (!spec.startsWith("node:")) {
				const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
				const devOnly = file === "src/core/math/mathjax-lib.cjs" && name.startsWith("@mathjax/");
				if (!runtimeDeps.has(name) && !devOnly) fail(`pi: ${file} imports ${spec}, which is not a dependency or peer dependency`);
			}
		}
	}
	console.log(`pi-better-render ${info.version}: ${files.length} files, ${(info.size / 1024 / 1024).toFixed(2)} MB packed`);
}

// better-render (installer)
{
	const dir = join(root, "packages", "better-render");
	const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	const { info, files } = packList(dir);
	for (const bin of Object.values(manifest.bin)) if (!files.includes(normalize(bin))) fail(`installer: bin ${bin} is not in the tarball`);
	for (const file of files) if (!/^(bin|src)\/|^(package\.json|README\.md|LICENSE)$/.test(file)) fail(`installer: ${file} must not be published`);
	if (Object.keys(manifest.dependencies ?? {}).length > 0) fail("installer: must not depend on any package (adapters install through their hosts)");
	console.log(`better-render ${info.version}: ${files.length} files, ${(info.size / 1024).toFixed(1)} kB packed`);
}

if (problems.length > 0) {
	console.error(problems.map((p) => `✖ ${p}`).join("\n"));
	process.exit(1);
}
console.log("✔ package contents ok");
