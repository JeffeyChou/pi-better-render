/**
 * better-render install --target pi|claude [--source <source>] [--dry-run]
 * better-render doctor [--json]
 *
 * `install` runs the chosen host's own install commands, only for that host,
 * and only the steps whose result is not there yet. `doctor` changes nothing:
 * it shows each host, its version, whether the adapter is installed, and the
 * render modes verified there.
 */
import { spawn } from "node:child_process";
import { TARGETS, UNSUPPORTED, unsupportedStatus } from "./targets.mjs";

const USAGE = `Usage:
  better-render install --target <${Object.keys(TARGETS).join("|")}> [--source <source>] [--dry-run]
  better-render doctor [--json]

install   Install the renderer into one host with that host's own installer.
          Nothing is changed when the host's CLI is missing or too old, and
          steps already done are skipped, so running it again is safe.
          --source  pi: the package source for \`pi install\` (default npm:pi-better-render)
                    claude: the marketplace source (default JeffeyChou/pi-better-render)
doctor    Show hosts, versions, what is installed and the verified render modes.

Not supported yet (doctor says why): ${Object.values(UNSUPPORTED).map((h) => `${h.name} (${h.host})`).join(", ")}.`;

/** Run a command and collect its output; undefined when it cannot be started (not on PATH). */
export function defaultRun(command, args, { inherit = false } = {}) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(command, args, { stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"], env: process.env });
		} catch {
			resolve(undefined);
			return;
		}
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (d) => (stdout += d));
		child.stderr?.on("data", (d) => (stderr += d));
		child.on("error", () => resolve(undefined));
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

function parseArgs(argv) {
	if (argv[0] === "--help" || argv[0] === "-h") return { command: "help", flags: {} };
	const [command, ...rest] = argv;
	const flags = {};
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--json" || arg === "--dry-run" || arg === "--help" || arg === "-h") flags[arg.replace(/^-+/, "")] = true;
		else if (arg === "--target" || arg === "--source") flags[arg.slice(2)] = rest[++i];
		else if (arg.startsWith("--target=") || arg.startsWith("--source=")) {
			const [key, value] = arg.slice(2).split(/=(.*)/s);
			flags[key] = value;
		} else return { command, flags, error: `unknown argument "${arg}"` };
	}
	return { command, flags };
}

function terminal(env) {
	if (env.TMUX) return "inside tmux (formula images off unless the host passes Kitty graphics through)";
	if (env.TERM_PROGRAM === "ghostty" || env.TERM === "xterm-ghostty") return "Ghostty (Kitty graphics)";
	if (env.TERM === "xterm-kitty" || env.KITTY_WINDOW_ID) return "kitty (Kitty graphics)";
	if (env.TERM_PROGRAM === "WezTerm") return "WezTerm (pi: direct Kitty placements; Claude Code: text)";
	return `${env.TERM_PROGRAM ?? env.TERM ?? "unknown"} (no Kitty graphics detected: formulas as text)`;
}

/**
 * @param {string[]} argv
 * @param {{ run?: typeof defaultRun, out?: (s: string) => void, err?: (s: string) => void, env?: NodeJS.ProcessEnv }} io
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io = {}) {
	const run = io.run ?? defaultRun;
	const out = io.out ?? ((s) => process.stdout.write(`${s}\n`));
	const err = io.err ?? ((s) => process.stderr.write(`${s}\n`));
	const env = io.env ?? process.env;
	const { command, flags, error } = parseArgs(argv);

	if (error) {
		err(`better-render: ${error}\n\n${USAGE}`);
		return 2;
	}
	if (!command || flags.help || command === "help") {
		out(USAGE);
		return command ? 0 : 2;
	}

	if (command === "doctor") {
		const report = [];
		for (const target of Object.values(TARGETS)) {
			const status = await target.status(run, {});
			report.push({ target: target.name, host: target.host, supported: true, ...status, minVersion: target.minVersion, modes: target.modes });
		}
		for (const host of Object.values(UNSUPPORTED)) {
			const status = await unsupportedStatus(run, host);
			report.push({ target: host.name, host: host.host, supported: false, installed: false, ...status, reason: host.reason, checkedVersion: host.checkedVersion });
		}
		if (flags.json) {
			out(JSON.stringify({ terminal: terminal(env), targets: report }, null, 2));
			return 0;
		}
		out(`terminal: ${terminal(env)}`);
		for (const r of report) {
			out("");
			if (!r.supported) {
				out(`${r.host} (${r.target}): not supported yet`);
				out(`  version:  ${r.cli ? r.version : `not found (${r.target} is not on PATH)`}`);
				out(`  why:      ${r.reason} (checked with ${r.checkedVersion}).`);
				continue;
			}
			out(`${r.host} (--target ${r.target})`);
			if (!r.cli) {
				out(`  not found: ${r.problem}`);
				continue;
			}
			out(`  version:  ${r.version}${r.minVersion ? `   (verified from ${r.minVersion})` : ""}`);
			out(`  adapter:  ${r.installed ? "installed" : "not installed"}${r.detail ? ` (${r.detail})` : ""}`);
			if (r.problem) out(`  problem:  ${r.problem}`);
			out("  verified render modes:");
			for (const mode of r.modes) out(`    - ${mode}`);
		}
		return 0;
	}

	if (command === "install") {
		const name = flags.target;
		const target = name ? TARGETS[name] : undefined;
		const unsupported = name ? UNSUPPORTED[name] : undefined;
		if (unsupported) {
			err(`better-render: ${unsupported.host} is not supported yet: ${unsupported.reason} (checked with ${unsupported.checkedVersion}). Nothing was changed.`);
			return 1;
		}
		if (!target) {
			err(`better-render: ${name ? `unknown target "${name}"` : "--target is required"}; targets: ${Object.keys(TARGETS).join(", ")}. Nothing was changed.`);
			return 2;
		}
		const options = { source: flags.source };
		const status = await target.status(run, options);
		if (!status.cli || status.problem) {
			err(`better-render: cannot install into ${target.host}: ${status.problem}. Nothing was changed.`);
			return 1;
		}
		const steps = await target.plan(run, options, status);
		if (steps.length === 0) {
			out(`${target.host}: already installed (${status.detail}). Nothing to do.`);
			return 0;
		}
		for (const step of steps) {
			const line = `${step.command} ${step.args.join(" ")}`;
			if (flags["dry-run"]) {
				out(`would run: ${line}   # ${step.why}`);
				continue;
			}
			out(`running: ${line}`);
			const result = await run(step.command, step.args, { inherit: true });
			if (!result || result.code !== 0) {
				err(`better-render: "${line}" failed${result ? ` (exit ${result.code})` : ""}.`);
				return 1;
			}
		}
		if (!flags["dry-run"]) {
			const after = await target.status(run, options);
			out(after.installed ? `${target.host}: installed (${after.detail}).` : `${target.host}: install ran, but the adapter is not listed yet; run \`better-render doctor\`.`);
			if (target.name === "claude") out("Start a new Claude Code session (or run /reload-plugins) to load it.");
			return after.installed ? 0 : 1;
		}
		return 0;
	}

	err(`better-render: unknown command "${command}"\n\n${USAGE}`);
	return 2;
}
