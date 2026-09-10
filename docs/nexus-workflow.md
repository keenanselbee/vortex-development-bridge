Nexus Release Workflow
======================

The repository follows Grailwright's authored short/file/full-description and
reviewed-changelog filenames. Full description uses Nexus BBCode. Local checks
retain the existing 350-character short and 255-character file description limits.
CHANGELOG.txt contains complete history; nexus-changelog.txt starts with exact
TargetVersion and BaselineVersion headers followed by reviewed release entries.

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
require a future explicit mapping adapter. Changing project configuration requires
staging under the new configuration fingerprint before promotion.
