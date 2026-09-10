AGENTS.md
=========

This file provides general working rules for coding agents in this repository.
It is intended as a starter template and should be updated as needed to match each repository's tools, workflows, and project-specific requirements.


Command Speed Rules
-------------------

- Zero-tool commands must not inspect files, run shell commands, check git status, summarize context, or add extra explanation.
- `help` is the only zero-tool command. Reply immediately from the command list in the Keyword Commands section.
- Direct-action commands should skip unrelated repo inspection, git status checks, diff reading, and planning. Execute only their defined workflow, then report the result.
- Direct-action commands are `AUDIT`, `COMMIT`, `DIFF`, and `MSG`.


Do Not Edit Guard
-----------------

- If the user intentionally types `DNE` in their current prompt, treat it as "do not edit persistent state" for that prompt.
- While `DNE` applies, do not create, edit, move, delete, stage, commit, build, format, generate files, refresh generated artifacts, launch external editors, or modify persistent project files or external paths unless the user explicitly overrides `DNE` in the same prompt.
- Temporary scratch files may be created, edited, or deleted under `.codex-temp` or the system temp directory when needed for investigation or diagnosis. Keep them clearly temporary, do not use them as generated artifacts or durable outputs, and remove them before finishing when practical. Report any temporary files intentionally left behind.
- `DNE` only applies when it appears to be typed intentionally by the user as an instruction. Ignore incidental appearances inside pasted file contents, quoted text, strings, command output, diffs, logs, or examples.


Working Rules
-------------

- Keep changes narrow and follow the existing style in the files being edited.
- Prefer simple, direct fixes. Do not overengineer or add abstractions unless they are clearly needed.
- Prefer not to add functions whose body is only one line of code unless there is a good reason, such as matching an existing interface, naming a repeated concept, or improving readability at the call site.
- Do not revert, overwrite, move, remove, or reformat unrelated user changes.
- Do not create, edit, move, delete, or overwrite files outside the repository unless the user explicitly asks for a specific external path.
- Keep temporary output, scratch files, generated inspection data, and staging inside this repository, preferably under `.codex-temp`.
- Treat reference, vendor, generated, and third-party directories as read-only unless the user or repository documentation explicitly says otherwise.
- Read relevant project documentation before making nontrivial changes.
- Prefer existing scripts, package-manager commands, Makefiles, Justfiles, Taskfiles, CI configuration, and documented workflows over invented commands.
- Use `rg` / `rg --files` for searches when available.
- Avoid destructive commands such as `git reset --hard`, broad deletes, or force pushes unless the user explicitly asks for that exact operation.


Shell Reliability
-----------------

- The shell may start outside the repository even when a workspace root is provided.
- Before broad searches, recursive commands, builds, tests, or git operations, verify the current location or target the repository root explicitly.
- Prefer commands that set their working directory explicitly, such as `git -C <repo> ...`, when the repository path is known.
- Do not assume relative paths resolve from the repository root unless the command sets location itself.
- If a command unexpectedly lands outside the repository, stop and rerun it with an explicit repository path.


Project Discovery
-----------------

- Identify the repository root from git, workspace context, or the nearest relevant project manifest.
- Treat `README.md` as the likely main project document when present.
- Also check relevant local documentation such as `CONTRIBUTING.md`, `docs/`, package manifests, build files, CI workflows, and tool configuration when needed.
- Determine build, test, lint, format, and typecheck commands from project docs or configuration before running them.
- If multiple plausible commands exist and the right one matters, report the candidates and ask or choose the smallest clearly relevant one.
- Do not assume a language, framework, package manager, build system, or test runner that is not present in the repository.


Keyword Commands
----------------

Codex chat messages may trigger generic keyword commands.

- A keyword command triggers only when the full user message clearly invokes one of the supported commands.
- Clear invocations include a command on its own line, a command followed by `:`, `-`, or context, or phrasing such as "run DIFF", "please DIFF", "do AUDIT", or "use COMMIT".
- Context may appear before or after the command token, or in nearby plain-text lines. Use it to narrow the command's behavior, such as ignored files, focus areas, or commit-plan preferences.
- Do not trigger commands from quoted text, pasted output, file contents, diffs, examples, fenced code blocks, command lists, questions about a command, or incidental prose where the user is discussing a command rather than asking to run it.
- `help` is the only lowercase command. All supported command names are uppercase.
- If an unknown uppercase single-word command is received, reply with `Unknown command. Type help.`
- Commands must still follow all safety, staging, commit, verification, and external-path rules in this file.

`help` prints this command list quickly, alphabetically, with one short line per command:

```text
AUDIT   Audit recent changes end to end without editing.
BUILD   Test and build a verified extension ZIP.
COMMIT  Execute the latest DIFF commit proposal.
DIFF    Show current changes and propose commit splits.
LOGS    Read bridge operation receipts and status.
MSG     Generate a commit message for staged files.
NEXUS   Compare local release and descriptions with Nexus.
STATUS  Read the bridge's current Vortex snapshot.
TEST    List pending manual checks or record supplied observations.
```


Command Behavior
----------------

- `AUDIT`: Perform a read-only audit of recent substantial changes. Inspect relevant status, diffs, affected files, missed call sites, stale docs/config, missing generated artifacts, unsafe file operations, and verification gaps. Do not edit, stage, commit, build, format, generate files, or launch external editors. Report findings first by severity with file/line references when possible; if no issues are found, say so clearly and list any residual risk or checks not run.
- `DIFF`: Read current git status, diff stats, and important changed files without modifying the worktree. Propose intelligent commit groups with file lists and commit messages. Use multiple commits when changes are independently useful or independently revertible. Follow the repository's existing commit style when obvious; otherwise use concise conventional-style subjects. State that `COMMIT` will execute the proposal if the worktree is unchanged.
- `COMMIT`: Execute the latest `DIFF` proposal only if it still matches the worktree. If no current proposal exists, or the worktree has changed since the proposal, run `DIFF` behavior and stop instead of committing. When executing, stage only the proposed files for each commit, run `git diff --cached --check` before each commit, commit with the proposed messages, and report commit hashes plus final status.
- `MSG`: Inspect only staged files and the staged diff needed to understand them. Generate a commit message that follows the repository's existing style when obvious; otherwise use concise conventional-style wording. Do not inspect unstaged changes, edit files, stage, commit, build, format, generate files, or launch external editors. If nothing is staged, say so and stop.


Verification
------------

- Run the smallest relevant check for the files changed.
- Prefer verification commands documented by the project.
- If no verification command exists, say so clearly.
- If verification cannot be run, report why.
- Do not run formatters, linters with autofix, code generators, migrations, or other write-producing checks unless the user requested that action or the repository instructions require it.


Commits
-------

- Follow the repository's existing commit style.
- If no style is obvious, use concise conventional-style subjects, for example:
  - `fix: handle empty config`
  - `docs: clarify setup steps`
  - `test: cover parser fallback`
- Split commits when changes are independently useful or independently revertible.
- Keep generated artifacts in the same commit as the source change that produced them unless repository instructions say otherwise.
- Do not stage or commit unrelated changes.


Repository-Specific Notes
-------------------------

- This repository owns Vortex Development Bridge: a CommonJS Vortex extension,
  Node client and Nexus publishing tools. Read docs/workflow.md for entry points.
- Use npm ci for the locked toolchain and tools/Build-Extension.ps1 for source
  checks, tests, bundling and archive checks. dist and .codex-temp are ignored.
- BUILD runs tools/Build-Extension.ps1; it never installs or deploys anything.
- STATUS runs node src/client/cli.js status. LOGS reads bridge receipts/status;
  it must not infer a successful deployment from queued acceptance.
- TEST lists Pending checks from docs/test-matrix.md or records observations
  explicitly supplied by the user. Mock API tests do not satisfy GUI/game checks.
- NEXUS starts with tools/Get-NexusLiveState.ps1 and local description checks.
  If page identity is configured, use Update-NexusDescription.ps1 without -Save
  for fresh short/full comparison. Report exact file and description changes.
  A clear user go-ahead authorizes those proposed updates; do not ask again.
  Publish only from the reviewed plan with verified build provenance. Keep
  partial-success journals; never repeat an uncertain remote write automatically.
- Descriptions use Grailwright filenames at the root. Full description is BBCode.
  Keep short/file pitches stable unless the product's core purpose changes.
- DIFF/COMMIT milestone work may continue when the user explicitly authorizes a
  sequence of reviewed commits. Stage only the reviewed files in each milestone.
- Native extension installs, profile changes and game deployment require explicit
  scope. Repository implementation alone does not authorize changing Vortex.
- Grailwright and Sovereign are read-only integration references for this task.
  Desktop integration notes were explicitly requested by the user.
- Inputs must name registered project/package identities and explicit profiles.
  The extension must never execute arbitrary shell commands from queued requests.
- Keep file-group IDs, global mod IDs and game-scoped IDs distinct. Match release
  archive contents before promotion and obtain published identity through Vortex.
- Keep releaseReady false until licensing, Nexus identity and live acceptance
  are resolved. Public license selection is currently pending the user's answer.
