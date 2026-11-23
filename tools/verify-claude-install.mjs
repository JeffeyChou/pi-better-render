/**
 * Install the Claude Code plugin from this repository's marketplace into an
 * empty Claude Code configuration, through the better-render installer, and
 * run the plugin's tests against the copy Claude Code installed.
 *
 *   - the installed copy is the plugin folder alone (no repo, no node_modules)
 *   - installing twice changes nothing
 *   - nothing is written for pi
 *
 * Needs the `claude` CLI (2.1.330 or later); no login is needed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "better-render-claude-"));
const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") };
const run = (cmd, args) => execFileSync(cmd, args, { env, cwd: home, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const installer = join(root, "packages", "better-render", "bin", "better-render.mjs");

try {
	const first = run(process.execPath, [installer, "install", "--target", "claude", "--source", root]);
	process.stdout.write(first);
	const settingsPath = join(env.CLAUDE_CONFIG_DIR, "settings.json");
	const settings = readFileSync(settingsPath, "utf8");
	const second = run(process.execPath, [installer, "install", "--target", "claude", "--source", root]);
	if (!/already installed/.test(second)) throw new Error(`second install did something:\n${second}`);
	if (readFileSync(settingsPath, "utf8") !== settings) throw new Error("second install changed settings.json");
	if (existsSync(join(home, ".pi"))) throw new Error("installing for Claude Code wrote pi configuration");

	const plugin = JSON.parse(run("claude", ["plugin", "list", "--json"])).find((p) => p.id === "better-render@pi-better-render");
	if (!plugin) throw new Error("plugin not listed after install");
	const files = readdirSync(plugin.installPath).sort();
	console.log(`installed copy: ${plugin.installPath}\n  ${files.join(" ")}`);
	if (files.some((f) => /^(src|node_modules|packages|vendor|test|tools)$/.test(f))) throw new Error("installed copy holds more than the plugin folder");
	process.stdout.write(run("claude", ["plugin", "test", plugin.installPath]));
	console.log("✔ Claude Code plugin installs from the marketplace and runs from its own folder");
} catch (error) {
	if (error.stdout) process.stdout.write(error.stdout);
	if (error.stderr) process.stderr.write(error.stderr);
	throw error;
} finally {
	rmSync(home, { recursive: true, force: true });
}
