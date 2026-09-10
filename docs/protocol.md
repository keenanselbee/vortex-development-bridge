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
Supported operations are stage, deploy, verify and promote. Requests never contain
shell commands. A receipt distinguishes pending, running, completed, failed,
expired and interrupted work. An interrupted mutating operation requires review;
it must not be replayed automatically.

Prepared directories contain the final staging layout, not an arbitrary installer
archive. Explicit modType selects the installed game's deployment type. The bridge
does not infer installers from filenames. File manifests preserve paths, sizes and
SHA-256 hashes. The bridge rejects links, traversal and case collisions.
