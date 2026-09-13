Vortex Development Bridge
=========================

Connect mod build tools to Vortex through explicit, recorded operations. Version
0.1.3 is a development preview. Development installation, Grailwright BepInEx
staging, canonical grouping, and explicit Test-profile activation, deployment,
verification and rollback have recorded live passes. Packaged installation, remaining
failure/recovery acceptance, Sovereign layouts and public publication are pending.

The extension runs inside Vortex. The command-line client requires Node.js 22 or
newer. Project build tools produce a prepared directory in the final Vortex staging
layout; the bridge handles registration, version activation and deployment.

Installation and use
--------------------

Install the built ZIP through Vortex's Extensions screen, enable the extension and
restart Vortex. Open Development Bridge to register a project, stage a prepared
directory, verify a build or activate a retained version. The default finalization
action stages the final package and updates all profiles for its game. Enabled
versions deploy when their profile is active and the game is closed; disabled
versions update without enabling or deploying. Otherwise work waits durably. Choose
**Stage only** to retain a build without activation or deployment, even under a
project with automatic legacy activation enabled. Stage only needs no profile.

Use `finish` for all game profiles, add `--profile <id>` to limit its scope, or use
`--stage-only` to stage without changing any profile selection. Absent packages
stay absent. Intermediate compilation remains the build tool's job.
See [finalization](docs/finalization.md) for offline queueing, cancellation and batches.

The ZIP includes client/vdb.cjs and example configurations. Run
`node client/vdb.cjs help` for command-line usage. Only the client requires a separate
Node installation. Publishing tools are available from a repository checkout.

Build IDs preserve distinct development outputs even when the release version has
not changed. The page displays each build ID so same-version outputs can be
distinguished. Rollback activates a retained build; it never removes newer versions.
Batch deployment verifies every selected package before activation and deploys once.
New untouched builds inherit the previous active version's ordering rules and file
overrides on first bridge activation. Retained versions keep their saved choices.
Receipts distinguish queue acceptance, waiting reasons, staging, deployment,
verification, cancellation, supersession, failure and interruption. Finalization's
new process checks and durable resume behavior have automated coverage; live
acceptance for this version remains pending.

Development
-----------

Run `npm ci` when dependencies change, then use `tools/Build-Extension.ps1` for the
ordered source check, build, and complete test pass. Generated output goes to ignored
`dist/`; scratch and local test data belong in `.codex-temp/`.

See [the workflow](docs/workflow.md), [the protocol](docs/protocol.md),
[Nexus publishing](docs/nexus-workflow.md), [manual acceptance](docs/test-matrix.md),
and the [public release checklist](docs/public-release-checklist.md).
No Nexus credentials are required for local use. The installation preview command is
`tools/Install-DevExtension.ps1`. While Vortex is closed, pass `-Install` for a new
development installation or `-Install -UpdateExisting` for a backed-up in-place
development update. Use Vortex's Extensions screen for normal packaged upgrades.
