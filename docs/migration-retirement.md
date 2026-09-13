Migration Retirement
====================

The one-time Grailwright publication migration was retired after its recorded
2026-09-11 closeout. All 21 eligible receipt-backed releases were already migrated
on the final dry run, with zero layout differences. The 44 excluded ambiguous
historical records remain outside the migration scope. See VDB-12 through VDB-14 in
the [acceptance matrix](test-matrix.md) for the original observations.


Recovery Record
---------------

VDB commit `8b0e0a52c2860936c5a916a635edd8f6112b1272` retains the complete reviewed
migration implementation, tests and procedures. Grailwright commit `0275bed`
retains its migration script and retired metadata extension. These are historical
source recovery points, not instructions to reinstall a consumer or replay a queue.
No archive copy of obsolete source is maintained in the current source tree.

The retired surface consists of `legacy-publication-dry-run`,
`legacy-publication-apply`, their client/engine/adapter handlers, the locally signed
migration receipt module, and the migration-only unattributed metadata exceptions.
An unprocessed old request fails as an unsupported operation without Vortex effects.
Completed receipts remain readable and are not replayed or rewritten.


Preserved Functionality And Data
-------------------------------

Registration, staging, deployment, verification, rollback, batch deployment,
canonical grouping, reconciliation and normal Nexus promotion remain supported.
Exact legacy/Nexus sibling checks remain necessary to avoid enabling conflicting
versions. Normal promotion still requires attributed Nexus metadata and exact
archive fingerprints before publishing mod attributes or linking a download.

The cleanup does not alter the installed extension, profile state, staging folders,
game files, retained builds, or recovery backups. Keep these existing local records:

- VDB's `requests`, `receipts`, `builds`, `artifacts`, `releases`,
  `migration-receipts` and `trust` directories under its configured bridge root
  (normally `%APPDATA%/Vortex/vortex-development-bridge`).
- Grailwright's `.vdb/stage-receipts` and older
  `.codex-temp/vdb-stage-receipts`; the historical lookup remains supported because
  receipts still exist in that older location.
- The retired `%APPDATA%/Vortex/grailwright-nexus-metadata` state and existing
  development-install/migration backups. Preserve whatever evidence remains;
  retirement does not imply every original archive is still available.

Future review of excluded records or recovery from historical source requires its
own exact scope. Neither is part of normal use or this source cleanup.
