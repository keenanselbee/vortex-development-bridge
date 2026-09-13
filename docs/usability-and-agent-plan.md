Developer and Agent Workflow Plan
=================================

Status: planned; reviewed against 0.1.3 source on 2026-09-12. The foundation below
exists; the five improvement phases remain planned unless explicitly noted.

The intended experience is: connect a project once, finish a checked build with
one action, and inspect a clear result. Manual developers, build scripts and AI
agents use the same configuration, validation, queue and receipts. The Vortex page
and CLI are interfaces to those operations, not separate workflow implementations.


Current foundation
------------------

The 0.1.3 source retains prepared-directory staging, durable finalization across
game profiles, explicit profile scope and stage-only. Enabled updates deploy when
their profile is active and the game is closed; disabled selections update without
enabling or deploying; absent packages remain absent. Queued work continues inside
Vortex without the submitting process. Some native acceptance remains pending in
the [test matrix](test-matrix.md).

Version 0.1.3 adds recovery of locks whose owner process has exited, retains the
abandoned lock as evidence, and briefly waits for active owners. Live or unverifiable
owners are not forcibly cleared. Normal process exit releases owned locks; polling
keeps ordinary contention quiet and dismisses stale errors after successful processing.
This does not authorize replay of an interrupted mutation or provide submission
idempotency. An interrupted recovery guard still requires inspection.

Review verification: all 27 tests in `tests/locks.test.js`, `tests/poll.test.js` and
`tests/finish.test.js` passed on 2026-09-12, including real child-process lock recovery
and fixture-based finalization. Native Vortex recovery remains pending under VDB-29;
these passes do not complete any planned usability phase or native acceptance gate.

Setup still requires hand-authored configuration and explicit registration. The
page has text fields for project/package IDs, artifact paths and versions. The CLI
can infer a project from a local config and a single package, but has no shared
setup/plan flow or durable caller retry key. Generic finalization permits multiple
payloads under one version even though Grailwright and Sovereign prohibit that.
The external client requires Node.js; MCP is not implemented.


User journeys and defaults
-------------------------

1. **Connect project:** choose the repository and managed game. Select an existing
   installed mod as a reviewed identity/layout reference, or create a new package.
   Choose the finished-build folder and version source. Preview deployment paths
   before saving and registering the project.
2. **Finish build:** choose a project/package only when ambiguous. Use remembered
   output paths and the checked version source. Update all game profiles by default;
   expose a specific profile and stage-only as secondary choices.
3. **Follow progress:** show queued, staged, waiting and completed outcomes, including
   each profile. Keep request IDs and hashes in expandable details. Never label an
   offline snapshot as a completed Vortex stage.
4. **Recover:** cancel remaining pending work or inspect a failed/interrupted phase.
   Retrying the same intent returns its original request and outcome. Enabling a
   disabled/absent mod, rollback and Nexus publication remain explicit operations.

The CLI never opens a dialog to resolve missing input. It reports the missing
fields/options in structured output. Explicit arguments override saved settings;
ambiguous choices are errors. A stale active-game snapshot is not a default game
or profile selection. Existing all-profile defaults do not require a profile ID.
The selected version source remains project-owned: no automatic version bumps.
Stage-only must not silently become a remembered default for subsequent finish calls.

Queue ordering follows the latest submitted intent for the matching package and
profile scope, not the highest numeric version found in the queue. A later specific
profile request replaces older all-profile work only in that profile; independent
packages and stage-only work remain separate. Already completed effects and retained
builds remain. Automatic selection still refuses to downgrade an installed newer
version. UI, CLI and Nexus copy must make this distinction clear wherever "latest"
could imply version sorting or cancellation of every older request.


Phase 1: Shared operations and automation contracts
-------------------------------------------------

Define reusable discovery, setup preview/apply, build plan, finish and diagnostic
operations. Move the page and CLI onto these operations without duplicating policy.
Finalize exact command names during this phase; intended surfaces are `setup`,
`plan`, `finish`, `status`, `receipt`, `wait`, `cancel` and `doctor`.

- Define a versioned JSON result envelope with operation, status, request ID when
  present, structured errors/waiting reasons, per-profile results and supported
  recovery actions. Keep stdout machine-readable and diagnostics on stderr.
- Document exit codes for accepted requests, pending work, validation failures,
  verification differences, cancellation, supersession and interrupted mutations.
  Preserve existing clients through capability negotiation or explicit migration;
  do not silently reinterpret their exit codes or request schemas.
- Make `plan` read-only: no registration, snapshot copies, version reservations,
  queue entries or profile changes. Report source freshness and intended scope.
  `finish` revalidates current files/configuration and freezes exact bytes.
- Add a caller-provided idempotency key shared by manual retry and CLI automation.
  Atomically bind it to project, package/build selection, configuration and profile
  scope. Identical retries return the original request, including after a lost
  response. Reusing a key for different inputs fails; an intentional new request
  gets a new key. Keep this separate from newer-intent supersession.
  Cover the existing publication boundary between the latest-intent index and the
  request file: a process exit there must have a recoverable, inspectable outcome.
  Lock recovery alone must not be reported as successful request submission, and
  retry must neither revive superseded work nor replay an uncertain mutation.
- Enforce fixed contents per project/package/version for new finalization requests.
  Identical content reuses the build; changed content requires a new version.
  Check existing artifacts/receipts and serialize reservations before enqueueing.
  Retain historical variants and legacy rollback; never delete or relabel them.
  For batches, a conflicting member prevents any batch request submission.

Automated exit criteria: contracts cover malformed/ambiguous input, stdout/stderr,
all terminal and pending outcomes, old/new capability combinations, read-only plans,
source changes after planning, concurrent same-version submissions, identical retry,
lost acknowledgement, scope mismatch and interruption at each reservation/submission
boundary, including index publication before request publication. Cover out-of-order
version submissions and overlapping all-profile/specific-profile batches, keeping
submission order distinct from downgrade protection. Existing queue, lock recovery,
polling, deployment and legacy protocol tests continue to pass.


Phase 2: Guided setup and remembered inputs
-----------------------------------------

Add a Connect project flow backed by the shared setup operation. Use Vortex's
managed games, configured mod types and installed-mod identities as discoverable
choices. Show human-readable names and actual source-to-destination examples.
Do not infer installer transformations from an arbitrary archive.

- Separate portable package identity from machine-local output/client paths.
  Choose an explicit schema/migration for remembered inputs and update examples.
- Support a literal version or a selected supported manifest field, initially JSON
  manifest fields. Reject missing, invalid or conflicting values. Never execute a
  repository script merely to discover its version.
- Preview generated configuration before applying it. Apply atomically, preserve
  unrelated existing fields, and report configuration drift instead of overwriting.
- Selecting an existing mod establishes a reviewed identity reference; it does not
  adopt its bytes, modify its Nexus metadata, enable it or deploy anything.
- Save and register once; reopen the project from any working directory. A new
  package remains absent from profiles until the user explicitly enables it.
- Expand `doctor` to explain client/extension capability mismatches, queue location,
  managed-game readiness, mod-type/layout problems and missing settings. A closed
  Vortex is a waiting condition when offline finalization can proceed.
  Distinguish temporary lock contention from unverifiable ownership and interrupted
  recovery. Report the affected path and inspection steps without deleting locks or
  replaying work as a side effect of diagnostics.

Automated exit criteria: new/existing configuration, paths with spaces and Unicode,
multiple packages/games, same-name mods, ambiguous legacy identity, custom queue
paths, missing Node/client, changed manifests, stale discovery and interrupted saves.
Verify no setup or diagnostic path enables mods, deploys files or sends credentials.


Phase 3: Manual workflow and actionable status
--------------------------------------------

Replace raw ID entry with project/package selectors. Automatically choose the only
valid option. Present Finish build as the primary action with visible all-profile
scope; retain specific-profile and stage-only choices.

Show remembered output/version inputs and an optional build preview. Explain
validation failures beside the relevant field. Present per-profile progress, such
as "Build saved; waiting for Vortex", "Disabled version updated", and "Updated in
2 profiles; waiting for 1". Expose Cancel only when meaningful and retain completed
effects in a partially cancelled result. Offer inspection instructions for uncertain
mutations rather than an automatic retry button. Explicit activation must identify
the selected mod and profile so it cannot be confused with normal finalization.
Preserve 0.1.3 polling behavior: a skipped or busy tick cannot clear an unresolved
error, and lock recovery is not evidence that a deployment completed. Show which
request superseded pending work and which package/profile work remains eligible.

Automated exit criteria: selector defaults, keyboard interaction, missing-input
messages, double-click submission protection, recovery action availability and
rendering of mixed profile outcomes. Exercise the same operation fixtures through
both the page adapter and CLI and compare resulting intents and effects.


Phase 4: Build hooks, agent guide and packaging
---------------------------------------------

Generate a quoted, working build-hook example that invokes finish only after the
project's build and checks succeed. Offer PowerShell and a direct CLI example.
Do not edit arbitrary build scripts automatically or watch source files by default.
Keep one stable client entry point that resolves a compatible bundled client instead
of embedding a downloaded release directory. The first implementation may still
require Node.js; report that dependency accurately.

Ship a concise agent/developer guide with command discovery, configuration precedence,
JSON examples, exit codes, idempotent retry, bounded waiting, cancellation and partial
failure recovery. Demonstrate both one-package finish and a coordinated batch.
Repository instructions should refer to this guide rather than copy protocol logic.
Agents must distinguish queued, staged and verified deployment in their reports.

Automated exit criteria: execute generated examples from a clean fixture checkout
and from another working directory, using paths with spaces. Verify a failed build
does not invoke finish, an offline run returns promptly, and an extension/client
upgrade preserves registrations, retry keys and pending requests. Check the actual
bundled ZIP and client, not only source imports. Use Grailwright and Sovereign as
integration fixtures; do not change their repositories implicitly.


Phase 5: Native acceptance and release readiness
-----------------------------------------------

After automated checks pass, use the exact candidate ZIP in an explicitly authorized
disposable Vortex setup. Record build hash, Vortex version, project configuration,
profile states and observed outcomes. Complete VDB-23 through VDB-29 in the
[test matrix](test-matrix.md), plus the existing profile/finalization acceptance
checks affected by the changes. Finish an entire manual path and an entire scripted
path; equivalent intents must produce equivalent results.

Include abandoned-owner recovery, bounded live-owner contention, unverifiable
ownership and warning clearance in VDB-29. Interrupt a disposable operation around
its receipt/mutation boundary and verify that recovery preserves evidence and does
not replay uncertain effects. Validate multiple queued versions with Vortex closed,
including out-of-order submissions and overlapping profile scopes under VDB-20.

Use `tools/Build-Extension.ps1` for the canonical source/build/test/archive sequence.
Run focused tests while implementing each phase and the full canonical checks at
integration milestones. Documentation-only planning requires whitespace/link checks,
not an application build. Native failures remain failed/pending and block claims of
verified support; fixture passes cannot substitute for them.

This plan does not authorize installation, live profile/game changes, Nexus uploads,
commits or publication. Review the concrete candidate and test targets before the
separate live acceptance step. Complete the existing license and publication gates
in the [release checklist](public-release-checklist.md) before public release.


Later interface work
--------------------

A standalone launcher that removes the separate Node.js requirement is a follow-up
after the CLI contract stabilizes. Decide its runtime, supported architectures,
packaging size, licensing, update compatibility and offline behavior before
implementation. A thin optional MCP adapter can follow the same shared operations
if it materially improves agent use. Neither adds different deployment rules or
bypasses explicit activation/publication boundaries.


Completion criteria
-------------------

A new manual user can connect a supported prepared-layout project without editing
JSON and finish a build without typing internal IDs. A script or agent can perform
the equivalent workflow without prompts, safely recover a lost response, and report
the exact outcome. Both preserve profile states, support offline queueing and
stage-only, reject changed contents under a used version, and preserve historical
builds and receipts. Automated and native evidence are recorded separately.
