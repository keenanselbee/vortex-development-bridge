Vortex Operations
=================

The client snapshots a prepared directory into the local bridge before queuing
staging. The extension obtains the active game's staging directory and the selected
mod type's deployment directory through Vortex. It verifies copies before registering
them with create-mod. Packages may declare a canonical `logicalFileName`; otherwise
their display name is used. Stable VDB project/package/build attributes remain the
ownership identity. Stage-only is the default; automatic activation only replaces
an already enabled compatible version and requires an explicit profile ID.

Deploy and rollback verify the complete stage first. Siblings with the same VDB
project and package IDs are compatible. A retained external sibling is compatible
only when its canonical logical filename and configured Nexus page ID match and its
source is either `nexus` or the retired Grailwright bridge's `grailwright-local`.
Any other same-logical-name record is ambiguous and stops staging, reconciliation,
and activation without mutation. The requested profile must already be active.
Vortex receives one deploy-mods request with the explicit profile ID.
The adapter uses callback-first argument order verified against the upstream
mod_management implementation; the generated events overview currently differs.

For coordinated packages, use deploy-batch with a JSON array of packageId/buildId
selections and one explicit profile. All selected stages are verified before any
activation; Vortex deploys once. Receipts preserve prior enabled versions for every
selection. This is not an atomic transaction: an activation/deployment failure can
leave partial state, which the receipt records for explicit recovery.

Client exit codes are 0 for success/queued submission, 1 for failure, 2 for a still
pending receipt and 3 for verification differences or a disabled verification target.
Read a request receipt or wait after submission; queue acceptance is not completion.

`reconcile` previews the exact VDB-owned records for one project/package in its
receipt, then changes only their `logicalFileName` attribute to the configured
canonical value. Compatible retained versions are inspected for collision safety
but are not adopted, deleted, reinstalled, or otherwise rewritten.

Legacy Publication Migration
----------------------------

`legacy-publication-dry-run` and `legacy-publication-apply` operate on one exact
project/package/staged ID and a reviewed migration receipt. The client copies the
receipt's archive into bridge-owned release storage and creates a locally trusted,
signed receipt before queueing. Dry-run reads the active game's exact live record,
staging directory, archive inventory, registered Nexus identity, and Vortex's exact
Nexus metadata lookup using the retained original archive filename, then records the
complete proposed metadata change without changing Vortex. Apply repeats every
check and only then imports/verifies the exact archive through Vortex and writes
canonical Nexus metadata. This keeps a batch from reaching apply when any candidate
is not yet indexed. It never creates VDB ownership, changes profile state, deploys,
deletes, reinstalls, or adopts a different staged record.

The signed receipt may separately set `nexus.allowUnattributedArchive` when the
retained Nexus release receipt has already proved the archive and publication IDs.
The metadata lookup may then return exactly one archive with the expected MD5 and
byte size and no source, mod ID, file ID, or filename. The bridge records this as
`exact-unattributed-archive` and derives the Nexus metadata only from that signed
receipt. Multiple fingerprint matches, any partial attribution, or a fingerprint
mismatch still fail closed. This exception is independent of the staged identity
tuple and unavailable to ordinary promotion.

The receipt must require source `grailwright-local`, its exact logical filename,
page ID, version, SHA-256, MD5, size, and Nexus file/version IDs. Those four live
identity fields normally must match. A locally signed receipt may explicitly allow
a wholly unattributed legacy record when the retired staging workflow created the
exact folder before its grouping request was consumed. That exception applies only
when all four fields are absent and the staged ID, installation path, complete
folder inventory, archive fingerprints, release receipt, and current package Nexus
identity agree. Partial metadata, an alias, conflicting ownership, a payload
difference, or any identity mismatch remains terminal. An already exact,
archive-linked migrated record is reported as `already-migrated` without another
Vortex write.

Vortex can return an imported archive ID before its download record has finished
hashing. Apply waits for that exact returned record to retain the expected MD5 and
size before writing mod attributes or linking the archive.
Bridge-owned release copies use a content-addressed `vdb-<sha256>.zip` basename when
passed to Vortex, preventing unrelated retained releases from colliding as a generic
`release.zip`. The signed original filename remains the metadata-lookup and display
identity; no existing download archive is replaced.

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

Promotion has three pre-effect retry conditions: its exact stage has not completed,
the target game is not active, or Vortex has not indexed the exact Nexus archive
metadata yet. Those receipts remain `pending` and are retried until completion or
request expiry. Import/deployment timeouts and all other failures remain terminal
because their side effects may be uncertain.

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
