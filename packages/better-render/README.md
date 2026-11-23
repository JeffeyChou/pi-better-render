# better-render

One command to set up [pi-better-render](https://github.com/JeffeyChou/pi-better-render)'s formula and table rendering in a coding agent you already use. It runs that host's own installer and nothing else.

```sh
npx better-render install --target pi       # pi install npm:pi-better-render
npx better-render install --target claude   # Claude Code plugin from the pi-better-render marketplace
npx better-render doctor                    # hosts, versions, what is installed, verified render modes
```

- `install` installs one target only, and never edits the other host's configuration.
- Steps whose result is already there are skipped, so running `install` again changes nothing.
- When the host's CLI is missing, too old, or the target is unknown, it says so and changes nothing.
- `--dry-run` prints the host commands without running them.
- Codex (`codex`) and the Antigravity CLI (`agy`) are not supported yet: neither has an extension
  point that changes how a reply is drawn in the terminal. `doctor` lists them with their version and
  this reason, and `install --target codex|agy` refuses without running anything.
- `--source` installs from somewhere else: a pi package source (`./checkout`, `npm:pi-better-render@0.6.0`) or a Claude Code marketplace (`owner/repo`, a URL, a folder).

The package has no dependencies: each adapter comes from its own host's installer, not from npm through this package.
