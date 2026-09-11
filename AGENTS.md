AGENTS.md
=========

These instructions apply to Vortex Development Bridge.

- For this checkout under `C:\Repositories`, read `C:\Repositories\System\AGENTS.md` for shared working rules and project routing. The rules below are project-specific additions and overrides.
- If the shared file is unavailable in another environment, report that and use the available local instructions and project documentation.


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
- Grailwright and Sovereign are integration references. Changes to those
  repositories require explicit scope in the current request.
- Inputs must name registered project/package identities and explicit profiles.
  The extension must never execute arbitrary shell commands from queued requests.
- Keep file-group IDs, global mod IDs and game-scoped IDs distinct. Match release
  archive contents before promotion and obtain published identity through Vortex.
- Keep `releaseReady` false until the release gates in `docs/workflow.md` are
  satisfied. Use `package.json` and `mod.json` for declared licensing and Nexus
  identity, and `docs/test-matrix.md` for recorded acceptance evidence.
