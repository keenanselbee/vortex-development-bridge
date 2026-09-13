Finalization
============

Finish is the normal last step after a mod's code, documentation, version and local
checks are complete. It freezes the final prepared package, stages it in Vortex,
then deploys an update to an enabled version when safe. Keep ordinary intermediate
compiles local. Finalization does not publish to Nexus or require Nexus credentials.

Update both the client and extension to 0.1.2 before using this workflow. The new
`profile-finish-v3` capability is separate from legacy protocol-1/2 operations. This
version has isolated automated coverage; live acceptance is tracked in
[the test matrix](test-matrix.md).


Choose the mode
---------------

```text
vdb finish --project demo --package main --artifact <prepared-directory> --version 1.0.1
vdb finish --project demo --package main --artifact <prepared-directory> --version 1.0.1 --profile <profile-id>
vdb finish --project demo --package main --artifact <prepared-directory> --version 1.0.1 --stage-only
```

The page exposes **Update all game profiles**, **Update active profile only**, and
**Stage only**. Stage only does not require a profile, can stage for
an inactive managed game, and never activates, inherits conflict rules or deploys.
It overrides any legacy automatic-activation policy saved in the project config.
It retains normal immutable-copy validation, visible build identity and receipts.

Finish defaults to all existing profiles for the registered game, captured when the
consumer first stages the request. `--profile` limits the scope to one profile.
It never switches the active game or profile. Enabled matching packages update and
deploy when their profile is active and the game is closed. Disabled packages move
their profile selection history to the new disabled build without deployment.
Absent packages stay absent. Stage-only changes no profile selection.

Disabled selection uses Vortex's supported `setProfile` action to transfer only the
matching disabled mod-state entries atomically, retaining unrelated profile data.
Old installed builds remain available for rollback. This avoids Vortex's ordinary
version-selection UI, which enables the chosen version. See the upstream
[profile reducer](https://github.com/Nexus-Mods/Vortex/blob/master/src/renderer/src/extensions/profile_management/reducers/profiles.ts)
and [version grouping](https://github.com/Nexus-Mods/Vortex/blob/master/src/renderer/src/extensions/mod_management/util/modGrouping.ts).
Native display and event behavior remain manual acceptance items.

Equal, newer or incomparable selected versions stay selected, preventing automatic
downgrades or same-version replacement. A regular version can replace an older
numeric version with a `-dev.*` suffix, including the same numeric release target.
Use the retained build's **Activate and deploy** action, or explicit
`deploy`, to make those intentional changes. Explicit activation is a separate
immediate operation and must be used only when the game is closed.


Offline waiting and cancellation
--------------------------------

The client snapshots the exact artifact before returning a request ID. Subsequent
source edits cannot change the queued payload. Vortex consumes that local request
when its extension is running. Finish requests do not expire during downtime.

Staging may complete while deployment waits. Waiting reasons distinguish an
inactive target game/profile, a running game/tool and unavailable process
inspection. On Windows the bridge checks Vortex's running-tool state and a fixed
read-only process inventory, including processes launched outside Vortex. Processes
inside the game install, and matching game executable names with hidden paths,
block deployment. Other platforms wait for supported process verification. The
checks are repeated immediately before profile changes and deployment; no software
check can prevent a user starting the game concurrently after the final check.

```text
vdb wait --request <id> --seconds 30
vdb receipt --request <id>
vdb cancel --request <id>
```

`wait` reports pending with exit code 2 instead of pretending deployment succeeded.
Cancel is also available beside a pending finalization in the page. A busy consumer
can briefly prevent cancellation; retry once that operation has settled. Completed,
failed, interrupted or already-mutating work cannot be cancelled as if it had no
effects. Inspect its receipt for recovery. Stage-only finalization is independent
of previously authorized deployment requests; cancel those separately if needed.

Profiles finish independently. Completed profiles are not replayed while another
profile waits. Cancellation stops the remaining work and retains prior effects and
their receipts. A newer specific-profile request supersedes an older all-profile
request only for that profile; a newer all-profile request supersedes older specific
requests for matching packages. Stage-only has an independent scope.

For the same project/package/profile, a newer submitted finish supersedes an older
pending selection before activation starts. Non-overlapping members of an older
batch remain eligible. Once profile effects start, that operation completes or
reports failure; a new request cannot retroactively cancel it. Older staged builds
and all receipts are retained for recovery. Changing a registered project config
invalidates queued requests rather than silently changing their meaning.


Several packages
----------------

Pass a JSON array of prepared packages to `finish-batch`:

```json
[
  { "packageId": "main", "artifact": "C:/builds/main", "version": "1.0.1" },
  { "packageId": "textures", "artifact": "C:/builds/textures", "version": "1.0.1" }
]
```

```text
vdb finish-batch --project demo --builds <prepared-builds.json>
vdb finish-batch --project demo --builds <prepared-builds.json> --stage-only
```

All packages must prepare successfully before the request becomes visible.
The extension stages and validates the eligible replacements before profile
effects, inherits applicable conflict rules, activates them and asks Vortex to
deploy once per eligible active profile. It then compares live files against the
staged manifests. A mismatch fails finalization with recorded verification details.

Vortex's actions are not a transaction across several mods. A failure after
conflict inheritance or activation begins remains terminal, with prior selections
and the completed phases in the receipt. Never blindly replay it. Review the
profile and deployed files, then use explicit deployment or rollback to recover.
Neither recovery nor stage-only removes retained versions or clears receipts.
