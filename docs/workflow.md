Repository Workflow
===================

Run npm ci once to install the locked toolchain. Use tools/Build-Extension.ps1 for
syntax checks, tests, bundling, ZIP verification and bundled-client smoke checks.
Builds are immutable directories under dist; dist/latest.json locates the latest
verified artifact. Build receipts include source hashes so Nexus preparation rejects
stale output. No build installs an extension or deploys a game.

Command-line example
--------------------

```text
node src/client/cli.js register --config examples/minimal/vdb.json
node src/client/cli.js doctor
node src/client/cli.js finish --project example-project --package main --artifact <prepared-directory> --version 0.1.1
node src/client/cli.js wait --request <returned-request-id>
```

Edit the example's game and mod type before using it. --bridge redirects all local
queue data for isolated testing. In the install ZIP use client/vdb.cjs instead of
src/client/cli.js. Registration and staging are also available on the Vortex page.
The client infers the project from a vdb.json in the current directory and infers
the package when the registered project has exactly one package. Explicit arguments
take precedence. STATUS can be narrowed with --project.

Finalization defaults to all profiles for the game, preserving enabled/disabled
states. Add `--profile` to narrow it. Enabled versions deploy when active and safe;
disabled versions update without deployment; absent packages remain absent. Add `--stage-only` and
omit `--profile` to stage without activation or live-file changes. The page exposes
both choices. Use `finish-batch` to prepare several final packages and deploy once.
See [finalization](finalization.md) for examples and durable waiting semantics.
The existing protocol-1 `stage` and explicit `deploy` commands retain their legacy
behavior; their expiring requests are not the durable finalization workflow.

Nexus and release
-----------------

See [Nexus workflow](nexus-workflow.md) for local checks, browser description review,
first-file creation, subsequent version updates and recovery. Inspect the actual
archive, not just a successful process exit. Never publish from a stale build receipt.

Use [manual acceptance](test-matrix.md) for observed Vortex results. The examples
are configuration templates, not evidence that a game's production integration has
passed. Public release is blocked until licensing, Nexus identities and manual
acceptance are resolved. Follow the [public release checklist](public-release-checklist.md)
for the ordered remaining steps.
