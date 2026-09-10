Vortex Development Bridge
=========================

Connect mod build tools to Vortex through explicit, recorded operations. Version
0.1.0 is a development preview. Live Vortex acceptance and Nexus publication are
not yet complete.

The extension runs inside Vortex. The command-line client requires Node.js 22 or
newer. Project build tools produce a prepared directory in the final Vortex staging
layout; the bridge handles registration, version activation and deployment.

Installation and use
--------------------

Install the built ZIP through Vortex's Extensions screen, enable the extension and
restart Vortex. Open Development Bridge to register a project, stage a prepared
directory, verify a build or activate a retained version. The selected profile must
already be active. Stage-only is the default.

The ZIP includes client/vdb.cjs and example configurations. Run
`node client/vdb.cjs help` for command-line usage. Only the client requires a separate
Node installation. Publishing tools are available from a repository checkout.

Build IDs preserve distinct development outputs even when the release version has
not changed. Rollback activates a retained build; it never removes newer versions.
Batch deployment verifies every selected package before activation and deploys once.
Receipts distinguish queue acceptance, completion, failure and interruption.

Development
-----------

Run `npm ci`, `npm test`, `npm run check`, and `npm run build`. Generated output goes
to ignored `dist/`; scratch and local test data belong in `.codex-temp/`.

See [the workflow](docs/workflow.md), [the protocol](docs/protocol.md),
[Nexus publishing](docs/nexus-workflow.md), and [manual acceptance](docs/test-matrix.md).
No Nexus credentials are required for local use. The installation preview command is
`tools/Install-DevExtension.ps1`; use Vortex's Extensions screen for normal upgrades.
