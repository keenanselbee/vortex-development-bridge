Manual Acceptance
=================

Record observed outcomes only. Fake API tests do not satisfy these checks.

VDB-12 through VDB-14 are historical migration evidence. Their tooling is now
retired; preserve the observations and follow the [retirement record](migration-retirement.md).
VDB-11 is verified after publication; other pending checks are pre-publication gates.

| ID | Check | Status |
| --- | --- | --- |
| VDB-29 | With disposable requests, exit a lock owner, restart Vortex and observe automatic recovery with retained evidence; preserve live/unverifiable owners and interrupted recovery guards, clear warnings only after successful processing, and never replay an uncertain mutation | Pending; subprocess crash, concurrent recovery, live-owner and notification tests pass, but native Vortex acceptance is not yet recorded |
| VDB-23 | Connect a fresh project through the guided UI, review output paths, save/register, reopen and finish without hand-editing JSON or typing internal IDs | Planned; implement the developer/agent workflow first |
| VDB-24 | Run the generated hook and non-interactive CLI from a separate working directory; compare its scope, immutable build and effects with the equivalent manual action | Planned; implement the developer/agent workflow first |
| VDB-25 | Finish with Vortex closed, lose the submitting process's response, retry with the same key and verify one original request resumes when Vortex opens | Planned; implement the developer/agent workflow first |
| VDB-26 | Submit identical and changed contents under one version from page/CLI; verify reuse or clear rejection, retained historical variants and no duplicate profile effects | Planned; implement the developer/agent workflow first |
| VDB-27 | Exercise mixed enabled/disabled/absent/inactive profiles, stage-only, specific scope, cancellation and interrupted mutation; verify UI/JSON outcomes and offered recovery actions agree | Planned; implement the developer/agent workflow first |
| VDB-28 | Upgrade the installed extension/client with a pending request and remembered project settings; verify the stable entry point, compatibility diagnostics and retained receipts | Planned; implement the developer/agent workflow first |
| VDB-21 | Finish across enabled, disabled, absent and inactive profiles; verify disabled version display updates with no activation/deployment, absent profiles stay unchanged, and each enabled profile deploys once when active | Pending; automated fixture coverage only |
| VDB-22 | Upgrade a disabled Sovereign development build to 1.0.1, retain disabled state and prior installed bytes, then explicitly enable the new build and verify native version grouping and conflict choices | Pending; automated fixture coverage only |
| VDB-17 | Finish while Vortex is closed beyond 30 minutes; reopen on another profile, observe waiting, then select the target profile and verify exactly one update | Pending; automated fixture coverage only |
| VDB-18 | Finish while the game runs from Vortex and separately from Steam; verify no profile changes until the game closes and verify installed bytes afterward | Pending; automated fixture coverage only |
| VDB-19 | Use page and CLI stage-only with a legacy automatic activation policy, no active target profile, and multiple packages; verify no enabled or deployed changes | Pending; automated fixture coverage only |
| VDB-20 | Queue several versions while Vortex is closed, including out-of-order version submissions and overlapping all-profile/specific-profile scopes; verify submission-order supersession separately from downgrade protection, cancel pending work, retain non-overlapping batch members, disabled selections and old stages, and inspect interrupted activation without replay | Pending; automated fixture coverage only; expanded out-of-order acceptance not yet recorded |
| VDB-01 | Install ZIP using Vortex Extensions; restart and open Development Bridge | Pending |
| VDB-02 | Upgrade an installed bridge while preserving project registrations and receipts | Passed 2026-09-10: the backed-up development update retained Grailwright registration plus failed and completed stage receipts. |
| VDB-03 | Register a disposable project and stage without changing enabled mods | Pending |
| VDB-04 | Activate/deploy a build in a disposable profile; verify destination bytes | Passed 2026-09-10: Battlecry Voice Tuner 1.4.6 deployed in the Test profile and all 82 staged/live files verified exactly. |
| VDB-05 | Stage another build, including a same-version variant, and restore the retained prior build | Passed 2026-09-10: an 83-file same-version workflow variant deployed and verified, rollback restored the retained 82-file build, removed the marker, and changed no unrelated enabled mod. |
| VDB-06 | Observe conflicts and distinguish deployment completion from matching live bytes | Pending |
| VDB-16 | In disposable profiles, stage an untouched upgrade and inherit ordering stored on either mod plus per-file overrides; verify actual winners, preserve another profile using the old version, retain explicit empty choices on rollback, switch main/textures together, and reject pinned/ambiguous/cyclic rules or interrupted inheritance before activation | Pending; automated fixture coverage only |
| VDB-07 | Expire a queued request while Vortex is closed; confirm no later deployment | Pending |
| VDB-08 | Interrupt an operation; inspect receipt and recover without duplicate effects | Pending |
| VDB-09 | Qualify Grailwright's actual BepInEx mod type and prepared layout | Passed 2026-09-10: Battlecry Voice Tuner 1.4.6 staged 82 files with exact recorded hashes and default BepInEx layout. |
| VDB-10 | Qualify Sovereign's main and separate texture package layouts | Pending |
| VDB-11 | Publish approved extension ZIP, verify Nexus metadata and catalog listing | Pending |
| VDB-12 | Disable old Grailwright consumer and migrate without duplicate processing | Passed 2026-09-10: the legacy extension was moved to a recoverable backup, its queue was preserved, and no legacy activity appeared after restart. |
| VDB-13 | Reconcile Battlecry's retained VDB builds to the canonical logical filename in the disposable Test profile, confirm 1.4.5 and both 1.4.6 variants share one Vortex group, then switch away from and back to the baseline without enabling two versions or changing unrelated mods | Passed 2026-09-10: both VDB 1.4.6 variants were reconciled to `Battlecry Voice Tuner`, matching the retained legacy family; the marker variant deployed and verified, rollback restored baseline build `95169e9317f316b48cf0d2b3`, exactly one variant remained enabled, and the three unrelated enabled mods were unchanged. |
| VDB-14 | Migrate only exact receipt-backed legacy Nexus stages, retain every version, prove idempotence, and reject an inactive-profile deployment without side effects | Passed 2026-09-11: 21 candidates passed full archive/staging preflight; 20 were migrated and the previously migrated Soul and Service 3.7.3 was skipped. A second 21-candidate dry run reported every record `already-migrated` with zero layout differences. Request `8a54e77f-acb6-4732-bda7-93a1084d96d6` rejected inactive profile `k8cKjFZe0` before execution; Test profile `1-P9L0nXQ`, its enabled set, Battlecry baseline/marker state, five completed deployments, all retained stages, and 44 excluded ambiguous records were unchanged. |
| VDB-15 | Upgrade to the cleaned extension ZIP, retain registrations and historical receipts, distinguish same-version builds by their visible IDs, and stage/deploy/verify/rollback in the disposable Test profile without changing unrelated mods | Pending |
