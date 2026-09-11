Manual Acceptance
=================

Record observed outcomes only. Fake API tests do not satisfy these checks.

| ID | Check | Status |
| --- | --- | --- |
| VDB-01 | Install ZIP using Vortex Extensions; restart and open Development Bridge | Pending |
| VDB-02 | Upgrade an installed bridge while preserving project registrations and receipts | Passed 2026-09-10: the backed-up development update retained Grailwright registration plus failed and completed stage receipts. |
| VDB-03 | Register a disposable project and stage without changing enabled mods | Pending |
| VDB-04 | Activate/deploy a build in a disposable profile; verify destination bytes | Passed 2026-09-10: Battlecry Voice Tuner 1.4.6 deployed in the Test profile and all 82 staged/live files verified exactly. |
| VDB-05 | Stage another build, including a same-version variant, and restore the retained prior build | Passed 2026-09-10: an 83-file same-version workflow variant deployed and verified, rollback restored the retained 82-file build, removed the marker, and changed no unrelated enabled mod. |
| VDB-06 | Observe conflicts and distinguish deployment completion from matching live bytes | Pending |
| VDB-07 | Expire a queued request while Vortex is closed; confirm no later deployment | Pending |
| VDB-08 | Interrupt an operation; inspect receipt and recover without duplicate effects | Pending |
| VDB-09 | Qualify Grailwright's actual BepInEx mod type and prepared layout | Passed 2026-09-10: Battlecry Voice Tuner 1.4.6 staged 82 files with exact recorded hashes and default BepInEx layout. |
| VDB-10 | Qualify Sovereign's main and separate texture package layouts | Pending |
| VDB-11 | Publish approved extension ZIP, verify Nexus metadata and catalog listing | Pending |
| VDB-12 | Disable old Grailwright consumer and migrate without duplicate processing | Passed 2026-09-10: the legacy extension was moved to a recoverable backup, its queue was preserved, and no legacy activity appeared after restart. |
| VDB-13 | Reconcile Battlecry's retained VDB builds to the canonical logical filename in the disposable Test profile, confirm 1.4.5 and both 1.4.6 variants share one Vortex group, then switch away from and back to the baseline without enabling two versions or changing unrelated mods | Passed 2026-09-10: both VDB 1.4.6 variants were reconciled to `Battlecry Voice Tuner`, matching the retained legacy family; the marker variant deployed and verified, rollback restored baseline build `95169e9317f316b48cf0d2b3`, exactly one variant remained enabled, and the three unrelated enabled mods were unchanged. |
| VDB-14 | Migrate only exact receipt-backed legacy Nexus stages, retain every version, prove idempotence, and reject an inactive-profile deployment without side effects | Passed 2026-09-11: 21 candidates passed full archive/staging preflight; 20 were migrated and the previously migrated Soul and Service 3.7.3 was skipped. A second 21-candidate dry run reported every record `already-migrated` with zero layout differences. Request `8a54e77f-acb6-4732-bda7-93a1084d96d6` rejected inactive profile `k8cKjFZe0` before execution; Test profile `1-P9L0nXQ`, its enabled set, Battlecry baseline/marker state, five completed deployments, all retained stages, and 44 excluded ambiguous records were unchanged. |
