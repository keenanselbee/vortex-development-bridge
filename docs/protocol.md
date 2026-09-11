Bridge Protocol
===============

Protocol version 1 uses a per-user filesystem queue under
`%APPDATA%/Vortex/vortex-development-bridge`, or an explicit client override.
Only the extension consumes requests. Projects are registered explicitly by the
local client; possession of access to the same OS account is the trust boundary.
This is not a sandbox against other processes running as that user.

Project configurations are identified by a content fingerprint. Changes invalidate
older requests. Operations name project/package identities and carry a UUID,
creation time and expiry. Maximum lifetime is 24 hours; default is 30 minutes.
Supported operations are stage, deploy, deploy-batch, rollback, verify, promote,
reconcile, legacy-publication-dry-run, and legacy-publication-apply. Requests never contain shell commands. A receipt distinguishes
pending, running, completed, failed,
expired and interrupted work. An interrupted mutating operation requires review;
it must not be replayed automatically.

Completed builds remain addressable after a project metadata change when their
project, package, game, Vortex-owned stage, deployment type, and complete file
inventory still match. The current registered configuration remains authoritative
for grouping, activation, and publication. This permits metadata-only migrations
without discarding immutable rollback builds; it does not revive stale queued
requests or relax staged-byte verification.

Promotion-only pre-effect conditions may return to `pending`: a missing exact build,
an inactive target game, or an exact Nexus metadata lookup that has not appeared yet.
They are retried within the original expiry window. Errors after a potentially
mutating Vortex operation starts remain terminal.

Legacy publication migration uses a reviewed migration receipt, not a filename
guess. The receipt names exactly one project, package, game, staged ID, legacy
source/logical filename/page/version, immutable archive fingerprints, and the
published Nexus page/file/version identities. Before queueing either operation the
local client verifies and retains the archive in bridge-owned release storage, then
records a local-user HMAC signature over an immutable receipt copy. The extension
accepts only that signed copy. The same OS account remains the trust boundary. An
explicit `allowUnattributed` receipt flag permits only a wholly empty live legacy
identity tuple; the exact staged ID, installation path, archive, payload inventory,
and Nexus identities must still match. It never accepts a partial or conflicting
tuple. The signed archive record also retains the original safe filename so dry-run
can require Vortex to resolve the exact Nexus file before any apply request begins.
The independent signed `nexus.allowUnattributedArchive` flag permits one lookup
result with the exact MD5 and size and no source, page ID, file ID, or filename to
serve as archive evidence; the signed receipt supplies the missing attribution.
This does not relax the live staged-identity check governed by `allowUnattributed`.
Ambiguous, partial, or conflicting lookup results are rejected, and normal
publication promotion cannot use either exception.

Prepared directories contain the final staging layout, not an arbitrary installer
archive. Explicit modType selects the installed game's deployment type. The bridge
does not infer installers from filenames. File manifests preserve paths, sizes and
SHA-256 hashes. The bridge rejects links, traversal and case collisions.
