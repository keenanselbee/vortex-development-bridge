Nexus Release Workflow
======================

The repository follows Grailwright's authored short/file/full-description and
reviewed-changelog filenames. Full description uses Nexus BBCode. Local checks
retain the existing 350-character short and 255-character file description limits.
CHANGELOG.txt contains complete history; nexus-changelog.txt starts with exact
TargetVersion and BaselineVersion headers followed by reviewed release entries.

Listing identity and authored copy
---------------------------------

Use the stable title **Vortex Development Bridge** for the page and main file.
The extension belongs on its own Nexus Modding Tools page (`gameDomain: site`),
in the applicable Vortex User Extensions category. Do not publish it as a
Grailwright game mod or install its ZIP through the game's Mods page.

Keep the authored surfaces separate:

| Source | Purpose |
| --- | --- |
| `nexus-short-desc.txt` | Plain-text page summary, at most 350 characters |
| `nexus-file-desc.txt` | Plain-text main-download pitch, at most 255 characters |
| `nexus-full-desc.txt` | Full BBCode page: purpose, requirements, setup, profiles and troubleshooting |
| `CHANGELOG.txt` | Complete local version history |
| `nexus-changelog.txt` | Reviewed changes since the live Nexus baseline, posted under one target version |

`package.json` owns the extension version; the build generates matching `info.json`.
The Nexus upload uses that same version. Page/file titles and short/file pitches
stay stable between ordinary releases. Update the full page when durable behavior
or requirements change, and consolidate unpublished changes into the Nexus changelog.

The full description adapts Grailwright's visual template: a centered size-6 title
and italic subtitle, `[line]` dividers, a bold mod-name opening, six labelled feature
bullets, and `[heading]` size-5 section titles. Use the orange accent `#DA8E35` on
the title and every major header. Keep extension-specific installation and update
instructions; the Grailwright logo, game requirements and config-import prose do
not apply to this independent tool.

Record real values in `mod.json` after the page exists:

| Field | Meaning |
| --- | --- |
| `nexus.url` | Public Nexus page URL |
| `nexus.gameDomain` | `site` for the Modding Tools page |
| `nexus.gameScopedModId` | Page's numeric ID within `site` |
| `nexus.modId` | Global mod ID returned by the API |
| `nexus.groupId` | Stable main file group used for subsequent releases |

An immutable version ID and a game-scoped downloadable file ID belong to the
release receipt; neither replaces the stable group ID. Leave unknown identity
fields unset until verified. Keep the API key only in `NEXUS_API_KEY`.

The configured page is [Vortex Development Bridge](https://www.nexusmods.com/games/site/mods/2303).
On 2026-09-12 the API verified site page ID `2303`, global mod ID
`9856949946623`, and main file group `7955385`. Its existing main version was
`0.0.1`, immutable version ID `9856949954002`, game-scoped file ID `9682`.
The author's screenshot showed the page as unpublished. These identity checks
do not verify the uploaded archive, publication status or Vortex catalog visibility.
Use the existing group for updates; do not use `-CreateFile` for this page.
The local reviewed changelog now targets `0.1.3` from baseline `0.0.1`; release
preparation must recheck that live baseline before any upload.

First upload and later updates
------------------------------

1. Create the Nexus page and record/verify its page IDs. If a main group already
   exists, configure it rather than creating another.
2. Complete the release checklist and choose the distribution license. Build the
   final extension ZIP after metadata and packaged documentation are finalized.
3. Run local checks and an offline archive preview. Review the exact build receipt.
4. For the first file only, use `tools/Publish-NexusMod.ps1 -CreateFile` to prepare
   an online plan. For later versions use `tools/Publish-NexusMod.ps1` without that
   switch. The live file version supplies the changelog baseline.
5. After release authorization, publish the prepared plan with
   `tools/Publish-NexusMod.ps1 -Publish`. The existing-group path creates a new
   version and archives its previous version. It refuses duplicate version labels.
6. After the first successful upload, verify the returned group ID and record it
   in `mod.json` for future releases. Retain the completed first-upload plan and
   journal before changing that metadata; do not rerun it as a new upload.
7. Compare/save the authored page descriptions through the separate description
   tool, then verify the short description, full page, file pitch, changelog and
   active download independently. A description save does not update the file pitch.
8. Check catalog discovery independently with `node tools/nexus.js catalog`.

Use description-only updates when the intended file version already exists.
The extension's own updates use Vortex's extension installation/update mechanism;
the bridge's game-profile staging and promotion commands are for the mods it manages.
They must not deploy the extension into a game directory.

Nexus's [upload guide](https://github.com/Nexus-Mods/Vortex/wiki/How-to-upload-an-extension-to-nexus)
points to Modding Tools. Its [legacy general packaging guide](https://github.com/Nexus-Mods/Vortex/wiki/LEGACY-General-Packaging-extensions)
documents root `index.js`/`info.json`, stable extension names, matching semantic
versions and a single main download for general extensions. Catalog listing also
requires Nexus review; confirm the current review route for this general tool.
Do not promise automatic discovery solely from a successful upload.

Commands
--------

```powershell
tools/Build-Extension.ps1
node tools/nexus.js check
tools/Publish-NexusMod.ps1 -Offline
tools/Get-NexusLiveState.ps1
tools/Update-NexusDescription.ps1
tools/Update-NexusDescription.ps1 -LoginOnly
tools/Update-NexusDescription.ps1 -Save
tools/Publish-NexusMod.ps1
tools/Publish-NexusMod.ps1 -Publish
```

Check and offline preparation need no account. Online file inspection and uploads
use NEXUS_API_KEY from the environment. It is never stored in project configuration
or sent to storage servers. Description review/save uses a dedicated normal Chrome
profile and playwright-core; npm ci installs the driver, not a separate browser.
The wrapper refuses to attach if its debugging port is already occupied. It does
not launch Chrome with --no-sandbox. Saved descriptions are backed up and reread.

Publication requires a real page URL/global mod ID/game-scoped mod ID in mod.json,
a public license and releaseReady=true. A first upload can use -CreateFile after
the page exists; subsequent releases use the recorded groupId. Distinguish global
mod IDs, game-scoped mod IDs, file-group IDs, immutable version IDs and game-scoped
file IDs. They are not interchangeable.

Preparation writes .codex-temp/nexus-plan.json. Publish consumes that exact plan;
it rechecks source and archive hashes. It retains an upload journal under
.codex-temp/nexus-releases. A known created version can resume later verification
without another upload. An uncertain version/changelog POST is never blindly
repeated. Preserve the journal and reconcile the remote result first.

The publisher sends uploads using Nexus v3's signed storage URLs. Small uploads
include both hexadecimal MD5 in the API request and Content-MD5 on storage PUT;
larger archives use bounded multipart uploads. Page descriptions remain a separate
browser operation because the inspected API has no general mod-description writer.

Extension packaging and discovery
---------------------------------

The ZIP has index.js and info.json at its root. Its bundled client, examples and
dependency licenses are included; repository publishing credentials and sources are
not included. Generated info.json and upload version match package.json.

Publish to the appropriate Vortex extension category on the Nexus site domain,
keeping one active main extension download. Publication and catalog visibility are
separately verified. The current OpenAPI includes unauthenticated GET
https://api.nexusmods.com/v3/vortex/extensions. A live read on 2026-09-10 returned
Ale and Tale Tavern mod 1599, file 6644, version 1.0.1. That exact extension also has
a public review submission; category placement alone is not assumed to guarantee
immediate visibility. Follow current Nexus guidance for general tool extensions.

- https://api.nexusmods.com/openapi.yaml
- https://github.com/Nexus-Mods/Vortex/issues/19193
- https://github.com/Nexus-Mods/Vortex/wiki/LEGACY-General-Packaging-extensions

Promoting a mod build
---------------------

Configure the package's nexus.gameDomain, gameScopedModId and groupId before staging.
Run vdb promote with the completed release journal and the retained build ID. The
extension compares the queued archive to the stage, asks Vortex to resolve its exact
published MD5/size/page/file identity, imports the archive and attaches its download
record. No API key is needed in the extension. Version labels alone are insufficient.
Version 1 expects archive paths to equal prepared staging paths; installer transforms
require a future explicit mapping adapter. A metadata-only registration change may
reuse an exact completed build when its ownership, game, deployment type and full
staged inventory still match. Queued requests require the current configuration
fingerprint; stale requests must be submitted again.
Promotion may be submitted before the stage consumer finishes. Missing build state,
an inactive target game, and not-yet-indexed exact Nexus metadata remain pending and
retry automatically until the request expires. Failures after an import may have
started are terminal and require inspection before a fresh request.
