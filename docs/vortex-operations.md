Vortex Operations
=================

For the normal final-package workflow use [durable finalization](finalization.md).
The stage/deploy operations below are retained protocol-1 primitives; their saved
activation policies do not override the explicit finish `--stage-only` option.

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

Bridge-owned release copies use a content-addressed `vdb-<sha256>.zip` basename
when passed to Vortex, preventing unrelated releases from colliding as `release.zip`.
Promotion waits for the imported download record to retain the exact MD5 and size
before changing mod attributes or linking the archive.

The bridge checks live file hashes against the game's deployment root. Additional
unrelated live files are permitted. A difference is reported rather than claiming
which competing mod won. Custom filename transformations are not supported by the
prepared-directory mode and need an adapter before declaring live verification.

Conflict inheritance
--------------------

Before explicit activation, a new untouched build inherits active `before`/`after`
rules from the single previous enabled compatible version. File override entries
retain their exact Vortex values only for paths present in the new prepared payload;
removed paths are listed in the receipt. Staging alone changes no conflict settings.
The same preflight runs for automatic replacement and coordinated batch deployment.

Incoming ordering tied to the previous instance is represented by an equivalent
inverse rule on the new build. The original owner is never rewritten, preserving
older versions and other profiles. References already matching the new version are
left alone. Batch references between replacing packages resolve to the new pair.
Vortex's supported reference matcher must still accept every transferred reference
after replacing its local ID; archive, source and version constraints are not relaxed.
Custom incoming rules that cannot be safely inverted stop activation for review.
Dependencies, recommendations, incompatibility and collection rules are not inherited
or rewritten by this feature. Ignored ordering rules are not re-enabled.

Existing target choices, including empty lists and any game-profile history, are
preserved. Retained stages created before this feature are not assumed to be fresh.
Rollback keeps the retained build's settings rather than copying the outgoing build's
choices onto it. This feature therefore does not retroactively repair earlier losses.

All batch inheritance plans are checked before any rule changes. Multiple possible
source versions, ambiguous local rule matches and cycles among the proposed enabled
mods stop the operation. This preflight covers locally stored ordering; Vortex remains
responsible for its full deployment checks, including metadata-supplied rules.
Plans are journaled, concurrent mod/profile changes are rejected, and an interrupted
application is marked for inspection. This is not a transaction across Vortex actions.
See [the protocol](protocol.md) for inheritance markers and receipt fields.

Automated coverage uses a fake Vortex API. Real conflict winner behavior, profile
isolation and upgrade/rollback acceptance remain VDB-16 in the manual matrix.
Live-byte verification remains strict; intentional overrides still appear as
differences, including to Sovereign's propagation consumer.


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

The consumer and client use directory locks with an owner PID and a unique
ownership token. Contenders wait up to one second for an active operation; the
consumer quietly retries on its next poll. Lock age never establishes abandonment.
An existing PID, including a reused PID, remains protected. Only a confirmed
missing process permits automatic recovery; process-inspection failures, malformed
or missing owner records, and interrupted recovery guards require inspection.

Recovery is serialized by a separate `.recovery` directory so competing callers
cannot recover a replacement owner's lock. The abandoned lock is retained beside
the original path as `.recovered-<unique-id>` for diagnosis. Normal process exit
also attempts synchronous cleanup of only its own token; forced termination is
handled by the next caller's owner check. A crash before owner metadata is written
or during recovery can still require manual inspection. Never delete a lock just
because it is old or a warning is visible.

A successful consumer poll dismisses its previous error notification, including
one retained across restart. Lock recovery does not replay operations: on the next
run, a running receipt becomes interrupted under the existing receipt rules.
Late Vortex callbacks can still finish after a timeout; inspect the application
before retrying.

References
----------

- https://github.com/Nexus-Mods/Vortex/blob/master/src/renderer/src/extensions/mod_management/index.ts
- https://github.com/Nexus-Mods/Vortex/blob/master/packages/vortex-api/README.md

Automated acceptance exercises a fake Vortex API. Actual application installation,
deployment and upgrades remain manual release gates.
