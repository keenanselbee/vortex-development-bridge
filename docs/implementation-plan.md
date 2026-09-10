Implementation Plan
===================

1. Project configuration, request protocol, filesystem validation and CLI.
2. Multi-game Vortex adapter, immutable staging, explicit profile activation,
   deployment verification, receipts and recovery.
3. Extension UI, distributable archive, examples and integration tests.
4. Nexus descriptions, release validation, publishing and remote verification.
5. Final audit, migration notes and manual acceptance handoff.

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
