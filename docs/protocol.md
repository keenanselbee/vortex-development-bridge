Bridge Protocol
===============

Protocol versions 1, 2 and 3 use a per-user filesystem queue under
`%APPDATA%/Vortex/vortex-development-bridge`, or an explicit client override.
Only the extension consumes requests. Projects are registered explicitly by the
local client; possession of access to the same OS account is the trust boundary.
This is not a sandbox against other processes running as that user.

Project configurations are identified by a content fingerprint. Changes invalidate
older requests. Operations name project/package identities and carry a UUID,
creation time and, for protocol 1, expiry. Protocol-1 maximum lifetime is 24 hours;
default is 30 minutes.
Supported operations are stage, deploy, deploy-batch, rollback, verify, promote,
and reconcile. Requests never contain shell commands. A receipt distinguishes
pending, running, completed, failed,
expired and interrupted work. An interrupted mutating operation requires review;
it must not be replayed automatically.

Protocol 3 `finish` carries 1-100 immutable builds, `stageOnly`, a `profileScope`
of `all`, `profile`, or `stage-only`, and a profile ID only for explicit scope.
The `profile-finish-v3` capability gates new submissions. All-profile membership
is captured at first consumption; receipts retain per-profile outcomes and completed
profiles are not replayed while another waits. Disabled selections transfer through
supported profile actions without activation or deployment. Overlapping all/specific
scope generations supersede only the affected package/profile work.

Retained protocol 2 adds only `finish`, carrying 1-100 immutable prepared build manifests,
an explicit `stageOnly` Boolean and a required target profile for deployment.
These intents have no time-based expiry. The client snapshots every artifact before
publishing the request. An atomic generation index under `intents/latest.json`
identifies the newest request per project/package/profile, or per package for
stage-only requests. Overlapping older pending selections are superseded while
non-overlapping selections in their batches remain eligible. Cancellation is
serialized with the consumer and never revives a superseded request.

The client and extension advertise `durable-finish-v2`. A fresh status from an older
consumer prevents submission; protocol-1 consumers reject protocol-2 requests
rather than interpreting them as permission to deploy. Upgrade both components
before using finish, including when Vortex is currently offline.

Finish can return to pending after completed staging while the target game/profile
is inactive, the game or a Vortex tool is running, or process inspection is
unavailable. The staged checkpoint and waiting reason remain visible. The
`deploymentStarted` journal boundary precedes any conflict inheritance or profile
effects. Any later error, timeout or interruption is terminal and needs inspection.
History retains the most recent 200 transitions; the current checkpoint persists.
See [finalization](finalization.md) for cancellation and recovery.

Completed builds remain addressable after a project metadata change when their
project, package, game, Vortex-owned stage, deployment type, and complete file
inventory still match. The current registered configuration remains authoritative
for grouping, activation, and publication. This permits metadata-only migrations
without discarding immutable rollback builds; it does not revive stale queued
requests or relax staged-byte verification.

New stage records carry `vdbConflictInheritance: pending`. First activation records
the inheritance plan, marks all affected targets `applying`, applies supported
Vortex actions, verifies retained values, and marks targets `initialized`. Existing
stages without this marker keep their settings. An explicit rules/overrides list
(even empty), or a target entry in any game profile, also preserves existing choices.
An `applying` marker blocks further activation until the interrupted operation is
reviewed; failed requests never replay partial rule writes. The receipt's
`conflictInheritance` entries identify source, target, disposition, inherited rules,
file overrides and omitted paths. See [conflict inheritance](vortex-operations.md#conflict-inheritance).

Protocol-1 promotion pre-effect conditions may return to `pending`: a missing exact build,
an inactive target game, or an exact Nexus metadata lookup that has not appeared yet.
They are retried within the original expiry window. Errors after a potentially
mutating Vortex operation starts remain terminal.

Prepared directories contain the final staging layout, not an arbitrary installer
archive. Explicit modType selects the installed game's deployment type. The bridge
does not infer installers from filenames. File manifests preserve paths, sizes and
SHA-256 hashes. The bridge rejects links, traversal and case collisions.

The one-time Grailwright publication migration is retired. Completed receipts remain
readable; unprocessed retired requests fail without Vortex changes. See the
[migration retirement record](migration-retirement.md).
