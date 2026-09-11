Commit Style
============

This guide documents a reusable commit-message style for repositories that prefer concise, Conventional Commit-inspired history without forcing every commit into a long template.


Subject Format
--------------

Use one of these subject shapes:

```text
type(scope): summary
type: summary
type(scope)!: summary
type!: summary
```

- `type` names the kind of change.
- `scope` is optional, but preferred when the touched area is clear.
- `!` marks a breaking change or a migration that meaningfully changes persisted behavior, public configuration, APIs, file formats, or runtime expectations.
- `summary` should be a concise present-tense phrase with no trailing period.


Commit Bodies
-------------

Use the shortest commit message that fully explains the change. A subject-only commit is correct when the subject says enough; a body is expected when the change is substantial, cross-system, risky, or hard to infer from the subject.

Commits often need a body when they touch:

- Core runtime scripts, controllers, native bridges, command handlers, or shared configuration.
- Native plugin source, package/build scripts, or generated runtime binaries.
- Persistence, public configuration keys, scripting/native contracts, migrations, user-facing workflows, or generated outputs.
- Multiple subsystems whose relationship is important to future reviewers.

Subject-only commits are fine for straightforward docs, simple bug fixes, asset moves, UI/audio refreshes, and narrow housekeeping. Compiled or generated output needs source context and should not be committed by itself unless the user explicitly requests a generated-output-only repair.

When a body is useful, prefer this shape:

- Put one blank line between the subject and body.
- Use bullets, usually 3-8.
- Use more bullets only when the change genuinely justifies it.
- Start each bullet with a verb and explain behavior, contracts, migration risk, or verification-relevant output.


Core Source Grouping
--------------------

Default to one commit per large core source file or subsystem when that makes the history easier to review and revert. Do not bundle unrelated controller, command, native bridge, UI, or persistence changes just because they share a language.

Group a core source file with another file only when the companion is part of the same change:

- Command source may travel with matching command registration, help, schema, or YAML files.
- Script/native bridge declarations may travel with matching native plugin bindings.
- A new imported subsystem may group its closely related files together.
- Documentation may travel with code when it documents the behavior introduced by that same commit.

Keep matching compiled outputs with the source commit that required the compile. Do not make standalone compiled-output commits when no source changed unless the user explicitly requests a generated-output-only repair.


Native Output Grouping
----------------------

Keep committed native DLLs, executables, or packaged plugin outputs with the source commit that required the rebuild. Native output should normally travel with the source change that produced it, not as a separate build-only commit.

Use a standalone `build(native): update plugin binary` commit only when the user explicitly asks for a binary-only refresh or generated-output-only repair. If a commit only normalizes binary path casing or packaging metadata, use `chore(native)` and include the rebuilt output in that same commit when needed.


Types
-----

Use the type that best describes the main reason for the commit.

| Type | Use For |
|---|---|
| `feat` | New behavior, user-facing capability, UI surface, asset set, or public-facing option. |
| `fix` | Bug fixes, corrections, and small behavior repairs. |
| `refactor` | Internal restructuring without intended user-facing behavior changes. |
| `docs` | README, release notes, listing copy, contributor notes, or repo documentation. |
| `style` | Formatting-only changes that do not alter behavior. |
| `test` | Test additions, fixture updates, or test harness changes. |
| `chore` | Repository maintenance, sync commits, cleanup, ignores, placeholders, and non-feature asset upkeep. |
| `build` | Build outputs, compiled artifacts, packaging changes, or build-system refreshes that are intentionally committed. |
| `ci` | Continuous integration workflow, automation, or release pipeline changes. |


Scopes
------

Scopes name the subsystem or asset area touched by the commit. Keep scopes lowercase and reuse existing names when they fit.

Common generic scopes:

```text
config
console
scripts
papyrus
plugin
skse
skse-plugin
native
ui
interface
assets
audio
esp
docs
nexus
tools
tests
ci
build
```

Leave the scope off when the change is naturally repo-wide or too small to name cleanly, such as `feat: add initial README`.


Practical Guidance
------------------

- Use lowercase `type` and `scope`.
- Keep summaries concise, present-tense, and without a trailing period.
- Prefer a scope when the touched area is clear.
- Split unrelated changes into separate commits.
- Bundle committed compiled-script refreshes with the source changes that produced them.
- Avoid standalone generated-output commits unless the user explicitly requests an exceptional generated-output-only repair.
- Bundle committed native binary refreshes with the source changes that produced them.
- Use `chore(plugin)` when syncing plugin metadata or packaged files with existing changes.
- Use `feat(esp)` or the repository's established data-file scope when record/data changes add or expose behavior.
- Use `docs(nexus)` for Nexus listing or permission copy, and `docs` without a scope for repo-facing documentation.


Examples
--------

Good generic examples:

```text
fix(interface): correct displayed resource limit
feat(controller)!: migrate persistence backend
docs(nexus): update listing permissions
chore(plugin): sync packaged plugin metadata
style(scripts): normalize Papyrus event formatting
```

A substantial controller commit can use a body like this because the change touches many systems:

```text
feat(controller): overhaul progression state

- Implement preset locking and positive configuration toggles in the controller
- Remap canonical progression states to the new public labels
- Add support for the new highest state across progression, caps, menus, UI, and event handling
- Rework reset flow with stored base state, staged effects, and terminal handling
- Centralize state resolution for resets, event handling, load catch-up, and console-driven changes
- Add historical data cleanup helpers for migrated character state
- Update load notification, feature availability, reset, and transition flows
```

A simple change should stay short:

```text
docs: add commit style guide
```
