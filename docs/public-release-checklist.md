Public Release Checklist
========================

VDB 0.1.3 remains a development preview. Grailwright's prepared BepInEx workflow has
recorded live staging, grouping, deployment, verification and rollback passes.
Source tests and archive checks do not qualify a new build in Vortex. Historical
passes remain recorded in the [acceptance matrix](test-matrix.md).


Before Publication
------------------

1. Complete the pending local acceptance checks: VDB-01 (packaged installation),
   VDB-03 (registration and stage-only behavior), VDB-06 (conflicts), VDB-07 (expiry),
   VDB-08 (interruption/recovery), VDB-10 (Sovereign package layouts), and VDB-15
   (upgrade to the cleaned build and distinguish same-version rollback targets).
   Qualify VDB-17 through VDB-20 for durable waiting, game-process guards,
   explicit stage-only, cancellation and supersession, and VDB-21/22 for all-profile
   updates and disabled Sovereign version selection. Complete VDB-29 for abandoned
   lock recovery and notification handling before publishing 0.1.3.
   Use disposable profiles and explicit installation/deployment authorization.
   VDB-02 records a development update, not a packaged-upgrade observation.
2. Choose and record the public license in `package.json` and `LICENSE`, update
   the lockfile's root metadata consistently, and retain the bundled dependency
   notices. The current declaration is `UNLICENSED`; no license has been selected.
3. Recheck the Nexus identity configured in `mod.json`: site page `2303`, global
   mod ID `9856949946623`, main file group `7955385`. The API verified its existing
   main version `0.0.1` on 2026-09-12; the author's screenshot showed the page as
   unpublished. Update this group rather than creating another. Review the
   short/file/full descriptions, release version and authored release changelog.
4. Once the pre-publication gates are satisfied, explicitly set `releaseReady`
   to true. This allows release tooling; it does not claim a successful upload or
   catalog listing. VDB-11 is the post-publication check below and cannot be
   completed before the first upload.
5. Run `tools/Build-Extension.ps1` and `node tools/nexus.js check`, then prepare and
   review the exact archive with `tools/Publish-NexusMod.ps1 -Offline`. The ZIP must
   contain the chosen license, root metadata, client, examples and documentation.
   Rebuild/review if any packaged source changes after acceptance.

Native-client or MCP interfaces, automatic retention cleanup, and arbitrary
installer transformations are outside the current 0.1 scope. They are not release
prerequisites. Do not claim support for an unqualified game/layout.


Publication And Discovery
-------------------------

Follow the [Nexus workflow](nexus-workflow.md) for online comparison, first-file
creation, guarded upload and description review. Publishing, saving descriptions
and submitting a review request require explicit authorization for the exact
reviewed result. This checklist performs none of those actions.

Nexus documents packaging and review submission for community game extensions in
its [packaging guide](https://github.com/Nexus-Mods/Vortex/wiki/How-to-package-a-game-extension).
Confirm the applicable review/category route for this general development tool;
do not assume a game-extension submission guarantees its catalog inclusion.

After publication, verify the exact uploaded version/archive and page metadata,
then independently verify Vortex catalog visibility and complete VDB-11. Keep the
upload journal and resolve uncertain remote results before any retry. Recheck
installation from the actual published download before announcing general use.
