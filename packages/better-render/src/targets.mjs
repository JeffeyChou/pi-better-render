/**
 * The hosts better-render can be installed into.
 *
 * Each target installs through its host's own command and nothing else: the
 * installer never edits a host's config files, never installs the other
 * target, and skips every step whose result is already there, so running it
 * twice changes nothing the second time. Adding a host means adding an entry.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** @typedef {(command: string, args: string[]) => Promise<{ code: number, stdout: string, stderr: string } | undefined>} Run */

/**
 * @typedef {object} Status
 * @property {boolean} cli         the host's CLI was found
 * @property {string} [version]    its version
 * @property {boolean} installed   the adapter is installed
 * @property {string} [detail]     what was found, in a few words
 * @property {string} [problem]    why install would refuse
 */

/**
 * @typedef {object} Step
 * @property {string} command
 * @property {string[]} args
 * @property {string} why
 */

/**
 * @typedef {object} Target
 * @property {string} name
 * @property {string} host          display name of the host
 * @property {string} cli           the host CLI's command
 * @property {string} [minVersion]  oldest host version this adapter was verified with
 * @property {string[]} modes       render modes verified on this host
 * @property {(run: Run, options: object) => Promise<Status>} status
 * @property {(run: Run, options: object, status: Status) => Promise<Step[]>} plan
 */

export const PI_PACKAGE = "npm:pi-better-render";
export const MARKETPLACE = "pi-better-render";
export const MARKETPLACE_SOURCE = "JeffeyChou/pi-better-render";
export const CLAUDE_PLUGIN = "better-render";

/** "2.1.330 (Claude Code)" → "2.1.330" */
export function parseVersion(text) {
	return /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(text ?? "")?.[0];
}

/** Compare dotted versions numerically; prerelease suffixes are ignored. */
export function compareVersions(a, b) {
	const pa = a.split(/[-+]/)[0].split(".").map(Number);
	const pb = b.split(/[-+]/)[0].split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return Math.sign(d);
	}
	return 0;
}

async function version(run, cli) {
	const result = await run(cli, ["--version"]);
	if (!result || result.code !== 0) return undefined;
	return parseVersion(result.stdout) ?? result.stdout.trim().split("\n")[0];
}

function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function tooOld(target, found) {
	if (!target.minVersion || !found || !parseVersion(found)) return undefined;
	return compareVersions(parseVersion(found), target.minVersion) < 0
		? `${target.host} ${found} is older than ${target.minVersion}, the oldest version this adapter is verified with`
		: undefined;
}

/** The package.json name in a folder, if it has one. */
function packageNameAt(dir) {
	if (!dir) return undefined;
	try {
		return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name;
	} catch {
		return undefined;
	}
}

/** A `pi list` source line that is this package. */
export function isPiBetterRender(line) {
	return /^npm:pi-better-render(@[\w.-]+)?$/.test(line) || /(^|[\\/])pi-better-render(-\d[\w.-]*\.tgz|[\\/]?)$/.test(line);
}

/** @type {Target} */
export const pi = {
	name: "pi",
	host: "pi",
	cli: "pi",
	modes: [
		"streaming: formulas and tables render while the reply streams in",
		"formula images: Kitty Unicode placeholders (Ghostty, kitty), direct Kitty placements (WezTerm)",
		"elsewhere: Unicode text for formulas",
	],
	async status(run, options) {
		const found = await version(run, "pi");
		if (found === undefined) return { cli: false, installed: false, problem: "pi was not found on PATH" };
		const list = await run("pi", ["list"]);
		// `pi list` prints each source, then the folder it resolved to, indented deeper.
		const entries = [];
		for (const raw of (list?.stdout ?? "").split("\n")) {
			const indent = /^\s*/.exec(raw)[0].length;
			const line = raw.trim();
			if (!line || line.endsWith(":")) continue;
			if (indent >= 4 && entries.length > 0) entries[entries.length - 1].path = line;
			else entries.push({ source: line });
		}
		// Any source of the package counts (npm, a version pin, a tarball, a local folder):
		// adding a second one would load the extension twice.
		const existing = entries.find(
			(e) => e.source === options.source || e.path === options.source || isPiBetterRender(e.source) || packageNameAt(e.path) === "pi-better-render",
		)?.source;
		return {
			cli: true,
			version: found,
			installed: Boolean(existing),
			detail: existing ? `from ${existing}` : undefined,
			problem: tooOld(pi, found),
		};
	},
	async plan(_run, options, status) {
		if (status.installed) return [];
		return [{ command: "pi", args: ["install", options.source ?? PI_PACKAGE], why: "install the pi package" }];
	},
};

/** @type {Target} */
export const claude = {
	name: "claude",
	host: "Claude Code",
	cli: "claude",
	minVersion: "2.1.330",
	modes: [
		"after each text block: Claude Code hands finished blocks to the plugin (no streaming)",
		"formula images: Claude Code's Image element, Kitty graphics (Ghostty, kitty)",
		"elsewhere, or inside tmux: Unicode text for formulas; tables still aligned",
	],
	async status(run, options) {
		const found = await version(run, "claude");
		if (found === undefined) return { cli: false, installed: false, problem: "claude was not found on PATH" };
		const marketplaces = parseJson((await run("claude", ["plugin", "marketplace", "list", "--json"]))?.stdout ?? "") ?? [];
		const plugins = parseJson((await run("claude", ["plugin", "list", "--json"]))?.stdout ?? "") ?? [];
		const marketplace = Array.isArray(marketplaces) ? marketplaces.find((m) => m?.name === MARKETPLACE) : undefined;
		const plugin = Array.isArray(plugins) ? plugins.find((p) => p?.id === `${CLAUDE_PLUGIN}@${MARKETPLACE}`) : undefined;
		return {
			cli: true,
			version: found,
			installed: Boolean(plugin),
			marketplace: Boolean(marketplace),
			detail: plugin
				? `${plugin.id} ${plugin.version ?? ""}${plugin.enabled === false ? " (disabled)" : ""}`.trim()
				: marketplace
					? `marketplace ${MARKETPLACE} added, plugin not installed`
					: undefined,
			problem: tooOld(claude, found),
		};
	},
	async plan(_run, options, status) {
		const steps = [];
		if (!status.marketplace) {
			steps.push({
				command: "claude",
				args: ["plugin", "marketplace", "add", options.source ?? MARKETPLACE_SOURCE],
				why: `add the ${MARKETPLACE} marketplace`,
			});
		}
		if (!status.installed) {
			steps.push({ command: "claude", args: ["plugin", "install", `${CLAUDE_PLUGIN}@${MARKETPLACE}`], why: "install the plugin" });
		}
		return steps;
	},
};

export const TARGETS = { pi, claude };

/**
 * @typedef {object} UnsupportedHost
 * @property {string} name
 * @property {string} host
 * @property {string} cli
 * @property {string} checkedVersion  the version the reason was checked against
 * @property {string} reason          why no adapter can be installed
 */

/**
 * Hosts `doctor` reports but `install` refuses: they have no extension point
 * that changes how a reply is drawn in the terminal, which both adapters rely
 * on (pi: its Markdown component; Claude Code: the AssistantMessage render hook).
 * Recheck when a new version of the host adds one.
 * @type {Record<string, UnsupportedHost>}
 */
export const UNSUPPORTED = {
	codex: {
		name: "codex",
		host: "Codex",
		cli: "codex",
		checkedVersion: "0.171.0",
		reason:
			"Codex has no extension point for drawing replies: plugins add skills, MCP servers, apps and hooks, none of them about display, and the only TUI extension is the status line",
	},
	agy: {
		name: "agy",
		host: "Antigravity CLI",
		cli: "agy",
		checkedVersion: "1.5.15",
		reason:
			"Antigravity CLI has no extension point for drawing replies in the terminal: plugins add skills, subagents, MCP servers and hooks, none of them about display, and UI sidecars, which show in the browser or IDE",
	},
};

/** Whether an unsupported host's CLI is there, and its version. */
export async function unsupportedStatus(run, host) {
	const found = await version(run, host.cli);
	return found === undefined ? { cli: false } : { cli: true, version: found };
}
