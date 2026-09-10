Vortex Operations
=================

The client snapshots a prepared directory into the local bridge before queuing
staging. The extension obtains the active game's staging directory and the selected
mod type's deployment directory through Vortex. It verifies copies before registering
them with create-mod. Stage-only is the default; automatic activation only replaces
an already enabled VDB-managed version and requires an explicit profile ID.

Deploy and rollback verify the complete stage first. Only siblings with the same
VDB project and package IDs are disabled. The requested profile must already be
active. Vortex receives one deploy-mods request with the explicit profile ID.
The adapter uses callback-first argument order verified against the upstream
mod_management implementation; the generated events overview currently differs.

The bridge checks live file hashes against the game's deployment root. Additional
unrelated live files are permitted. A difference is reported rather than claiming
which competing mod won. Custom filename transformations are not supported by the
prepared-directory mode and need an adapter before declaring live verification.

Recovery
--------

Each receipt records its phase, previous enabled siblings and target. Failed or
interrupted requests are not replayed. Read the receipt, compare Vortex state, and
submit a new explicit operation. A directory copied before registration is retained
for investigation and is not silently adopted. Never delete an unrelated stage.

The consumer uses a directory lock. After a process crash, inspect owner.json and
confirm that process is no longer running before removing that specific stale lock.
On the next run, a running receipt becomes interrupted. Late Vortex callbacks can
still finish after a timeout; inspect the application before retrying.

References
----------

- https://github.com/Nexus-Mods/Vortex/blob/master/src/renderer/src/extensions/mod_management/index.ts
- https://github.com/Nexus-Mods/Vortex/blob/master/packages/vortex-api/README.md

Automated acceptance exercises a fake Vortex API. Actual application installation,
deployment and upgrades remain manual release gates.
