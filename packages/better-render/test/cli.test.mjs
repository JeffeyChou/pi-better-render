/**
 * The installer against stand-in `pi` and `claude` executables that keep
 * their state in a JSON file and log every call. PATH holds nothing else, so
 * the real hosts are never touched.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/better-render.mjs", import.meta.url));

const FAKE_PI = `
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, "utf8"));
const args = process.argv.slice(2);
state.log.push("pi " + args.join(" "));
const save = () => fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(state));
if (args[0] === "--version") console.log(state.piVersion);
else if (args[0] === "list") console.log("User packages:\\n" + state.pi.map((p) => "  " + p + "\\n    /somewhere/" + p).join("\\n"));
else if (args[0] === "install") state.pi.push(args[1]);
save();
`;

const FAKE_CLAUDE = `
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, "utf8"));
const args = process.argv.slice(2);
state.log.push("claude " + args.join(" "));
const save = () => fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(state));
const is = (...a) => a.every((x, i) => args[i] === x);
if (is("--version")) console.log(state.claudeVersion + " (Claude Code)");
else if (is("plugin", "marketplace", "list")) console.log(JSON.stringify(state.marketplaces.map((name) => ({ name }))));
else if (is("plugin", "list")) console.log(JSON.stringify(state.plugins.map((id) => ({ id, version: "0.1.0", enabled: true }))));
else if (is("plugin", "marketplace", "add")) state.marketplaces.push("pi-better-render");
else if (is("plugin", "install")) {
  if (!state.marketplaces.includes(args[2].split("@")[1])) { console.error("no marketplace"); save(); process.exit(1); }
  state.plugins.push(args[2]);
}
save();
`;

/** A CLI that only answers --version, and logs every call. */
const fakeVersionOnly = (name, version) => `
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, "utf8"));
state.log.push(${JSON.stringify(name)} + " " + process.argv.slice(2).join(" "));
fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(state));
if (process.argv[2] === "--version") console.log(${JSON.stringify(version)});
`;

const FAKES = {
	pi: () => FAKE_PI,
	claude: () => FAKE_CLAUDE,
	codex: () => fakeVersionOnly("codex", "codex-cli 0.171.0"),
	agy: () => fakeVersionOnly("agy", "1.5.15"),
};

function setup({ hosts = ["pi", "claude"], state = {} } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "better-render-cli-"));
	const statePath = join(dir, "state.json");
	writeFileSync(statePath, JSON.stringify({ log: [], pi: [], marketplaces: [], plugins: [], piVersion: "1.5.2", claudeVersion: "2.1.330", ...state }));
	for (const host of hosts) {
		const file = join(dir, host);
		writeFileSync(file, `#!${process.execPath}\n${FAKES[host]()}`);
		chmodSync(file, 0o755);
	}
	const cli = (...args) =>
		new Promise((resolve) => {
			execFile(process.execPath, [BIN, ...args], { env: { PATH: dir, FAKE_STATE: statePath, TERM_PROGRAM: "ghostty" } }, (error, stdout, stderr) =>
				resolve({ code: error ? error.code : 0, stdout, stderr }),
			);
		});
	const read = () => JSON.parse(readFileSync(statePath, "utf8"));
	read.statePath = statePath;
	return { cli, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const changes = (log) => log.filter((line) => / install | marketplace add /.test(` ${line} `));

test("install --target pi uses pi alone, and a second run changes nothing", async () => {
	const { cli, read, cleanup } = setup();
	try {
		const first = await cli("install", "--target", "pi");
		assert.equal(first.code, 0, first.stderr);
		assert.deepEqual(read().pi, ["npm:pi-better-render"]);
		assert.ok(read().log.every((line) => line.startsWith("pi ")), "claude was called");

		const second = await cli("install", "--target", "pi");
		assert.equal(second.code, 0);
		assert.match(second.stdout, /already installed/);
		assert.deepEqual(read().pi, ["npm:pi-better-render"]);
		assert.equal(changes(read().log).length, 1);
	} finally {
		cleanup();
	}
});

test("install --target claude uses claude alone, and a second run changes nothing", async () => {
	const { cli, read, cleanup } = setup();
	try {
		const first = await cli("install", "--target", "claude");
		assert.equal(first.code, 0, first.stderr);
		assert.deepEqual(read().marketplaces, ["pi-better-render"]);
		assert.deepEqual(read().plugins, ["better-render@pi-better-render"]);
		assert.ok(read().log.every((line) => line.startsWith("claude ")), "pi was called");
		assert.ok(read().log.includes("claude plugin marketplace add JeffeyChou/pi-better-render"));

		const second = await cli("install", "--target", "claude");
		assert.equal(second.code, 0);
		assert.deepEqual(read().marketplaces, ["pi-better-render"]);
		assert.deepEqual(read().plugins, ["better-render@pi-better-render"]);
		assert.equal(changes(read().log).length, 2);
	} finally {
		cleanup();
	}
});

test("an existing marketplace is reused; --source picks another one", async () => {
	const { cli, read, cleanup } = setup({ state: { marketplaces: ["pi-better-render"] } });
	try {
		assert.equal((await cli("install", "--target", "claude")).code, 0);
		assert.deepEqual(changes(read().log), ["claude plugin install better-render@pi-better-render"]);
	} finally {
		cleanup();
	}
	const other = setup();
	try {
		assert.equal((await other.cli("install", "--target", "claude", "--source", "/src/pi-better-render")).code, 0);
		assert.ok(other.read().log.includes("claude plugin marketplace add /src/pi-better-render"));
	} finally {
		other.cleanup();
	}
});

test("pi installed from another source (a checkout, a tarball, a pinned version) is not installed twice", async () => {
	for (const existing of ["../code/pi-better-render", "/tmp/pi-better-render-0.6.0.tgz", "npm:pi-better-render@0.5.0"]) {
		const { cli, read, cleanup } = setup({ state: { pi: [existing] } });
		try {
			const result = await cli("install", "--target", "pi");
			assert.equal(result.code, 0);
			assert.match(result.stdout, /already installed/);
			assert.deepEqual(read().pi, [existing]);
		} finally {
			cleanup();
		}
	}
});

test("pi installed from a local folder of any name is recognized by its package.json", async () => {
	const folder = mkdtempSync(join(tmpdir(), "better-render-pkg-"));
	writeFileSync(join(folder, "package.json"), JSON.stringify({ name: "pi-better-render" }));
	// pi prints a folder source relative to its settings, and the resolved folder below it.
	const fakeList = `console.log("User packages:\\n  ../../some/package\\n    ${folder}")`;
	const { cli, read, cleanup } = setup({ state: {} });
	try {
		const piPath = join(dirname(read.statePath), "pi");
		writeFileSync(piPath, readFileSync(piPath, "utf8").replace(/else if \(args\[0\] === "list"\)[^\n]*/, `else if (args[0] === "list") ${fakeList};`));
		const result = await cli("install", "--target", "pi");
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /already installed \(from \.\.\/\.\.\/some\/package\)/);
		assert.equal(changes(read().log).length, 0);
	} finally {
		cleanup();
		rmSync(folder, { recursive: true, force: true });
	}
});

test("a missing CLI, an unknown target or a too old host is reported and nothing changes", async () => {
	const { cli, read, cleanup } = setup({ hosts: ["pi"], state: {} });
	try {
		const missing = await cli("install", "--target", "claude");
		assert.equal(missing.code, 1);
		assert.match(missing.stderr, /claude was not found.*Nothing was changed/);

		const unknown = await cli("install", "--target", "vim");
		assert.equal(unknown.code, 2);
		assert.match(unknown.stderr, /unknown target "vim".*Nothing was changed/);

		const none = await cli("install");
		assert.equal(none.code, 2);
		assert.equal(changes(read().log).length, 0);
	} finally {
		cleanup();
	}
	const old = setup({ state: { claudeVersion: "2.0.1" } });
	try {
		const result = await old.cli("install", "--target", "claude");
		assert.equal(result.code, 1);
		assert.match(result.stderr, /older than 2\.1\.330/);
		assert.equal(changes(old.read().log).length, 0);
	} finally {
		old.cleanup();
	}
});

test("--dry-run prints the host commands and runs none of them", async () => {
	const { cli, read, cleanup } = setup();
	try {
		const result = await cli("install", "--target", "claude", "--dry-run");
		assert.equal(result.code, 0);
		assert.match(result.stdout, /would run: claude plugin marketplace add/);
		assert.match(result.stdout, /would run: claude plugin install better-render@pi-better-render/);
		assert.equal(changes(read().log).length, 0);
	} finally {
		cleanup();
	}
});

test("doctor shows hosts, versions, install state and verified modes, and changes nothing", async () => {
	const { cli, read, cleanup } = setup({ hosts: ["claude"], state: { plugins: ["better-render@pi-better-render"], marketplaces: ["pi-better-render"] } });
	try {
		const text = await cli("doctor");
		assert.equal(text.code, 0);
		assert.match(text.stdout, /terminal: Ghostty/);
		assert.match(text.stdout, /pi \(--target pi\)\n {2}not found: pi was not found on PATH/);
		assert.match(text.stdout, /version: {2}2\.1\.330/);
		assert.match(text.stdout, /adapter: {2}installed \(better-render@pi-better-render 0\.1\.0\)/);
		assert.match(text.stdout, /verified render modes:/);

		const json = JSON.parse((await cli("doctor", "--json")).stdout);
		assert.deepEqual(json.targets.map((t) => [t.target, t.cli, t.installed]), [["pi", false, false], ["claude", true, true], ["codex", false, false], ["agy", false, false]]);
		assert.equal(changes(read().log).length, 0);
	} finally {
		cleanup();
	}
});

test("doctor reports codex and agy as not supported yet, with their versions and why", async () => {
	const { cli, read, cleanup } = setup({ hosts: ["pi", "claude", "codex"] });
	try {
		const text = await cli("doctor");
		assert.equal(text.code, 0);
		assert.match(text.stdout, /Codex \(codex\): not supported yet\n {2}version: {2}0\.171\.0\n {2}why: {6}Codex has no extension point for drawing replies/);
		assert.match(text.stdout, /Antigravity CLI \(agy\): not supported yet\n {2}version: {2}not found \(agy is not on PATH\)/);

		const json = JSON.parse((await cli("doctor", "--json")).stdout);
		const byName = Object.fromEntries(json.targets.map((t) => [t.target, t]));
		assert.equal(byName.pi.supported, true);
		assert.equal(byName.codex.supported, false);
		assert.equal(byName.codex.version, "0.171.0");
		assert.match(byName.codex.reason, /status line/);
		assert.deepEqual([byName.agy.supported, byName.agy.cli], [false, false]);
		assert.equal(changes(read().log).length, 0);
	} finally {
		cleanup();
	}
});

test("install --target codex or agy is refused without running anything", async () => {
	const { cli, read, cleanup } = setup({ hosts: ["pi", "claude", "codex", "agy"] });
	try {
		for (const [target, host] of [["codex", "Codex"], ["agy", "Antigravity CLI"]]) {
			const result = await cli("install", "--target", target);
			assert.equal(result.code, 1);
			assert.match(result.stderr, new RegExp(`${host} is not supported yet: .*Nothing was changed\\.`));
		}
		assert.deepEqual(read().log, []);
	} finally {
		cleanup();
	}
});

test("--help prints the usage, naming the hosts not supported yet", async () => {
	const { cli, cleanup } = setup();
	try {
		const result = await cli("--help");
		assert.equal(result.code, 0);
		assert.match(result.stdout, /install --target <pi\|claude>/);
		assert.match(result.stdout, /Not supported yet \(doctor says why\): codex \(Codex\), agy \(Antigravity CLI\)\./);
	} finally {
		cleanup();
	}
});
