Vortex Development Bridge
=========================

Connect mod build tools to Vortex through explicit, recorded operations. Development
version 0.1.0 is being implemented; live Vortex acceptance and Nexus publication are
not yet complete.

The extension runs inside Vortex. The command-line client requires Node.js 22 or
newer. Project build tools produce a prepared directory in the final Vortex staging
layout; the bridge handles registration, version activation and deployment.

Development
-----------

Run `npm ci`, `npm test`, `npm run check`, and `npm run build`. Generated output goes
to ignored `dist/`; scratch and local test data belong in `.codex-temp/`.

See [implementation milestones](docs/implementation-plan.md) and
[the protocol](docs/protocol.md). No Nexus credentials are required for local use.
