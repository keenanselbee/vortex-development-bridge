Implementation Plan
===================

The next planned work is the [developer and agent workflow plan](usability-and-agent-plan.md):
shared automation contracts, guided setup, manual UI, build hooks and separate
automated/native acceptance. Its standalone launcher and optional MCP interface
remain follow-up work. The entries below record the existing foundation.

1. Implemented: project configuration, request protocol, filesystem validation and CLI.
2. Implemented: multi-game Vortex adapter, immutable staging, explicit profile
   activation, coordinated package deployment, verification, receipts and recovery.
3. Implemented: extension page, bundled client, verified ZIP, examples and tests.
4. Implemented: Nexus descriptions, guarded publishing, verified metadata promotion,
   browser review/save and catalog lookup. No actual public release was attempted.
5. Grailwright staging, grouping and explicit deployment/rollback have recorded live
   passes. The one-time legacy publication migration is complete and its code is
   retired; see [the retirement record](migration-retirement.md).
6. Remaining manual acceptance and release setup are tracked in the
   [public release checklist](public-release-checklist.md).

Review each milestone using DIFF, then commit its reviewed files and continue.
Do not modify Grailwright, Sovereign, active Vortex extensions or live games as a
side effect of implementing this repository. Integration work is documented on the
Desktop at the user's request.

Release gates
-------------

Keep releaseReady false until installation, upgrade and deployment have been
observed in Vortex. Automated tests use a fake Vortex API and temporary directories.
Do not describe those tests as game or GUI acceptance. Nexus page/file identities
and the public license require real values before publication. The old Grailwright
queue consumer was disabled during qualification; preserve its recovery records.

Version 0.1 boundaries
----------------------

Prepared-directory mode is explicit; arbitrary archive installers and transformed
paths are not inferred. Status reports observed live differences without claiming
which conflicting mod won. No automatic retention cleanup or adoption of historical
Grailwright stages is enabled. Those operations need separately reviewed migration
plans. MCP and a standalone native client are optional future interfaces, not
requirements for the extension or Node client to operate.
