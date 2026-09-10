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
node src/client/cli.js stage --project example-project --package main --artifact <prepared-directory> --version 0.1.0
node src/client/cli.js wait --request <returned-request-id>
node src/client/cli.js deploy --project example-project --package main --build <returned-build-id> --profile <profile-id>
node src/client/cli.js wait --request <returned-request-id>
```

Edit the example's game and mod type before using it. --bridge redirects all local
queue data for isolated testing. In the install ZIP use client/vdb.cjs instead of
src/client/cli.js. Registration and staging are also available on the Vortex page.
The client infers the project from a vdb.json in the current directory and infers
the package when the registered project has exactly one package. Explicit arguments
take precedence. STATUS can be narrowed with --project.

Nexus and release
-----------------

See [Nexus workflow](nexus-workflow.md) for local checks, browser description review,
first-file creation, subsequent version updates and recovery. Inspect the actual
archive, not just a successful process exit. Never publish from a stale build receipt.

Use [manual acceptance](test-matrix.md) for observed Vortex results. The examples
are configuration templates, not evidence that a game's production integration has
passed. Public release is blocked until licensing, Nexus identities and manual
acceptance are resolved.
