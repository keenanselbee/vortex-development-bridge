"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { readJson, atomicJson, hash, fingerprint, differences, lock, inside } = require("../protocol/files");
const { inspectZip } = require("../protocol/archive");
const { VERSION } = require("../protocol/config");
const { api, upload } = require("./api");

function numeric(value, label) {
  if (!/^[1-9][0-9]*$/.test(String(value || ""))) throw new Error(`Configure a real ${label} in mod.json`);
  return String(value);
}
async function local(repo) {
  repo = path.resolve(repo);
  const manifest = await readJson(path.join(repo, "mod.json"));
  const pkg = await readJson(path.join(repo, "package.json"));
  if (!VERSION.test(pkg.version)) throw new Error("Invalid package version");
  const relative = manifest.nexus?.descriptionDirectory || ".";
  const directory = relative === "." ? repo : inside(repo, relative);
  const text = {}, sourceHashes = {};
  for (const [key, name, maximum] of [["short", "nexus-short-desc.txt", 350], ["file", "nexus-file-desc.txt", 255], ["full", "nexus-full-desc.txt", Infinity], ["changelog", "nexus-changelog.txt", 65535]]) {
    const file = path.join(directory, name);
    text[key] = (await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
    if (!text[key] || text[key].length > maximum) throw new Error(`${name} is empty or exceeds ${maximum} characters`);
    sourceHashes[file] = await hash(file);
  }
  for (const name of ["mod.json", "package.json"]) sourceHashes[path.join(repo, name)] = await hash(path.join(repo, name));
  return { repo, manifest, pkg, text, sourceHashes };
}
async function unchanged(plan) {
  for (const [file, expected] of Object.entries(plan.sourceHashes)) if (await hash(file) !== expected) throw new Error("Release source changed; prepare a fresh plan");
  if (await hash(plan.archive) !== plan.sha256) throw new Error("Release archive changed");
  const current = await local(plan.repo);
  if (fingerprint(current.manifest) !== fingerprint(plan.manifest) || fingerprint(current.pkg) !== fingerprint(plan.pkg)
      || fingerprint(current.text) !== fingerprint(plan.text)) throw new Error("Plan contents do not match the current release sources");
}
async function remote(manifest, invoke = api) {
  const n = manifest.nexus;
  if (!/^[a-z0-9]+$/.test(n.gameDomain)) throw new Error("Invalid Nexus game domain");
  const scoped = numeric(n.gameScopedModId, "game-scoped mod ID");
  const modId = numeric(n.modId, "global mod ID");
  const mod = await invoke("GET", `/games/${n.gameDomain}/mods/${scoped}`);
  if (String(mod.id) !== modId || String(mod.game_scoped_id) !== scoped) throw new Error("Nexus page identities do not match");
  const groups = (await invoke("GET", `/mods/${modId}/files`)).mod_files;
  if (!Array.isArray(groups)) throw new Error("Unexpected Nexus file groups");
  if (!n.groupId) return { mod, groups, versions: [], active: [] };
  numeric(n.groupId, "file-group ID");
  if (!groups.some(g => String(g.id) === String(n.groupId))) throw new Error("Nexus file group does not belong to this page");
  const versions = (await invoke("GET", `/mod-files/${n.groupId}/versions`)).versions;
  if (!Array.isArray(versions)) throw new Error("Unexpected Nexus version list");
  return { mod, groups, versions, active: versions.filter(v => ["main", "update", "optional", "miscellaneous"].includes(v.category)) };
}
async function prepare(repo, archive, invoke = api, options = {}) {
  const state = await local(repo);
  archive = path.resolve(archive);
  const files = await inspectZip(archive);
  if (state.manifest.packageKind === "vortex-extension") {
    if (!files.some(x => x.path === "index.js") || !files.some(x => x.path === "info.json")) throw new Error("Extension ZIP needs index.js and info.json at its root");
    const build = await readJson(path.join(path.dirname(archive), "build-receipt.json"));
    if (build.archive !== archive || build.version !== state.pkg.version || build.sha256 !== await hash(archive) || differences(build.files, files).length) throw new Error("Extension archive does not match its build receipt");
    if (!build.sourceHashes) throw new Error("Build receipt lacks source provenance; rebuild the extension");
    for (const [file, expected] of Object.entries(build.sourceHashes)) {
      const source = inside(state.repo, file);
      if (await hash(source) !== expected) throw new Error(`Build is stale: ${file}; rebuild before release preparation`);
      state.sourceHashes[source] = expected;
    }
  }
  const base = { ...state, archive, files, sha256: await hash(archive), md5: await hash(archive, "md5"), size: (await fs.stat(archive)).size, version: state.pkg.version };
  if (options.offline) return { ...base, status: "local-validated", remote: "not-checked" };
  const live = await remote(state.manifest, invoke);
  if (live.versions.some(v => v.version === base.version)) throw new Error("Version already exists; verify the existing release and use description-only updates");
  if (live.active.length > 1) throw new Error("Multiple active versions in the file group; reconcile before publishing");
  if (!state.manifest.nexus.groupId && !options.createFile) throw new Error("First upload requires --create-file or a configured existing groupId");
  if (!state.manifest.nexus.groupId && live.groups.some(g => g.name === state.manifest.displayName)) throw new Error("A matching file group already exists; configure it instead of creating another");
  const baseline = live.active[0]?.version || "none";
  const lines = state.text.changelog.split("\n");
  if (lines[0] !== `TargetVersion=${base.version}` || lines[1] !== `BaselineVersion=${baseline}` || lines.length < 3) throw new Error("Reviewed changelog headers do not match target and Nexus baseline");
  return { ...base, baselineId: live.active[0]?.id || null, baseline,
    groupId: state.manifest.nexus.groupId || null, createFile: !state.manifest.nexus.groupId,
    changelog: lines.slice(2).join("\n"), status: "prepared", activeIds: live.active.map(v => v.id).sort() };
}

async function publish(plan, invoke = api, uploader = upload) {
  if (plan.status !== "prepared") throw new Error("A verified remote release plan is required");
  if (!plan.manifest.releaseReady || !plan.pkg.license || plan.pkg.license === "UNLICENSED") throw new Error("Resolve release readiness and the public license before publishing");
  const journalRoot = path.join(plan.repo, ".codex-temp", "nexus-releases");
  const id = fingerprint({ modId: plan.manifest.nexus.modId, groupId: plan.groupId, version: plan.version });
  const journalPath = path.join(journalRoot, id + ".json");
  return lock(journalRoot, async () => {
    await unchanged(plan);
    let journal;
    try { journal = await readJson(journalPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (journal && (journal.sha256 !== plan.sha256 || journal.sourceIdentity !== fingerprint(plan.sourceHashes))) throw new Error("This release journal has different inputs; reconcile rather than publishing different bytes under the same version");
    if (journal?.status === "completed") return journal;
    if (journal && ["posting-version", "posting-changelog", "creating-file"].includes(journal.phase)) throw new Error("Prior remote write has an unknown outcome. Reconcile it before any retry; no duplicate write was sent");
    if (journal && !journal.versionId && journal.phase !== "uploaded") throw new Error("Interrupted upload or file creation requires inspection of its recorded remote ID before retrying");
    journal ||= { id, sha256: plan.sha256, sourceIdentity: fingerprint(plan.sourceHashes), archive: plan.archive, version: plan.version, groupId: plan.groupId, status: "running", startedAt: new Date().toISOString() };
    const progress = async values => { journal = { ...journal, ...values }; await atomicJson(journalPath, journal); };
    if (!journal.uploadId) {
      await progress({ phase: "starting-upload" });
      const uploadId = await uploader(plan.archive, progress, invoke);
      await progress({ phase: "uploaded", uploadId });
    }
    if (!journal.versionId) {
      await unchanged(plan);
      const current = await remote(plan.manifest, invoke);
      if (current.versions.some(v => v.version === plan.version) || JSON.stringify(current.active.map(v => v.id).sort()) !== JSON.stringify(plan.activeIds)) throw new Error("Nexus release state changed during upload");
      const body = { upload_id: journal.uploadId, name: plan.manifest.displayName, version: plan.version, description: plan.text.file,
        file_category: "main", primary_mod_manager_download: true, allow_mod_manager_download: true,
        show_requirements_pop_up: false, update_mod_version: true };
      if (plan.createFile) {
        await progress({ phase: "creating-file" });
        const created = await invoke("POST", "/mod-files", { ...body, mod_id: plan.manifest.nexus.modId });
        await progress({ phase: "file-created", groupId: numeric(created.id, "created file group ID") });
        const versions = (await invoke("GET", `/mod-files/${journal.groupId}/versions`)).versions;
        const matches = versions.filter(v => v.version === plan.version);
        if (matches.length !== 1) throw new Error("Created file requires remote reconciliation; do not repeat creation");
        await progress({ phase: "version-created", versionId: matches[0].id });
      } else {
        await progress({ phase: "posting-version" });
        const created = await invoke("POST", `/mod-files/${plan.groupId}/versions`, { ...body, archive_existing_file: true, previous_version_id: plan.baselineId });
        if (!created.version?.id) throw new Error("Version creation returned no immutable ID; inspect the remote outcome");
        await progress({ phase: "version-created", versionId: created.version.id });
      }
    }
    if (!journal.changelogPosted) {
      await progress({ phase: "posting-changelog" });
      const response = await invoke("POST", `/mods/${plan.manifest.nexus.modId}/changelogs`, { version: plan.version, changelog: plan.changelog });
      if (response.version !== plan.version || response.changelog !== plan.changelog) throw new Error("Changelog response needs reconciliation");
      await progress({ phase: "changelog-posted", changelogPosted: true });
    }
    const versions = (await invoke("GET", `/mod-files/${journal.groupId}/versions`)).versions;
    const current = versions.find(v => String(v.id) === String(journal.versionId));
    if (!current || current.version !== plan.version || current.category !== "main") throw new Error("Created version has not been verified as the active main release");
    await progress({ phase: "verified", status: "completed", completedAt: new Date().toISOString(), remoteVersion: current,
      receipt: { schemaVersion: 1, gameDomain: plan.manifest.nexus.gameDomain, gameScopedModId: plan.manifest.nexus.gameScopedModId,
        modId: plan.manifest.nexus.modId, groupId: journal.groupId, versionId: journal.versionId,
        gameScopedFileId: current.game_scoped_id, version: plan.version,
        archive: plan.archive, sha256: plan.sha256, md5: plan.md5, size: plan.size, files: plan.files },
      descriptions: "Separate browser review/save required" });
    return journal;
  });
}

module.exports = { local, remote, prepare, publish, unchanged, numeric };
