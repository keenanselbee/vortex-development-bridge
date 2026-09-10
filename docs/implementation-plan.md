Implementation Plan
===================

1. Implemented: project configuration, request protocol, filesystem validation and CLI.
2. Implemented: multi-game Vortex adapter, immutable staging, explicit profile
   activation, coordinated package deployment, verification, receipts and recovery.
3. Implemented: extension page, bundled client, verified ZIP, examples and tests.
4. Implemented: Nexus descriptions, guarded publishing, verified metadata promotion,
   browser review/save and catalog lookup. No actual public release was attempted.
5. Implementation review and Desktop integration notes completed. Manual acceptance
   handoff remains the next operational step; see test-matrix.md.

Review each milestone using DIFF, then commit its reviewed files and continue.
Do not modify Grailwright, Sovereign, active Vortex extensions or live games as a
side effect of implementing this repository. Integration work is documented on the
Desktop at the user's request.

Release gates
-------------

Keep releaseReady false until installation, upgrade and deployment have been
observed in Vortex. Automated tests use a fake Vortex API and temporary directories.
Do not describe those tests as game or GUI acceptance. Nexus page/file identities
and the public license require real values before publication. Preserve the old
Grailwright extension until an explicit migration disables its queue consumer.

Version 0.1 boundaries
----------------------

Prepared-directory mode is explicit; arbitrary archive installers and transformed
paths are not inferred. Status reports observed live differences without claiming
which conflicting mod won. No automatic retention cleanup or adoption of historical
Grailwright stages is enabled. Those operations need separately reviewed migration
plans. MCP and a standalone native client are optional future interfaces, not
requirements for the extension or Node client to operate.
