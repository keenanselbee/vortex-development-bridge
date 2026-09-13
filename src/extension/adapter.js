"use strict";

const { isDeepStrictEqual } = require("node:util");
const { planConflictInheritance } = require("./conflicts");

// Vortex is injected so the same contracts can be exercised without a live game.
function createAdapter(api, vortex, options = {}) {
  function context(gameId, profileId, allowInactive = false) {
    const state = api.getState();
    if (!allowInactive && vortex.selectors.activeGameId(state) !== gameId) {
      const error = new Error(`Activate game '${gameId}' in Vortex first`);
      error.code = "VDB_INACTIVE_GAME";
      throw error;
    }
    const activeProfile = vortex.selectors.activeProfile(state);
    const profile = activeProfile?.gameId === gameId ? activeProfile : undefined;
    if (profileId && (profile?.id !== profileId || profile.gameId !== gameId)) {
      const error = new Error("The requested profile is not active; no profile was switched");
      error.code = "VDB_INACTIVE_PROFILE";
      throw error;
    }
    const stagingRoot = vortex.selectors.installPathForGame(state, gameId);
    if (!stagingRoot) throw new Error("Vortex has no staging directory for this game");
    return { state, profile, stagingRoot, mods: state.persistent?.mods?.[gameId] || {} };
  }
  function profileContext(gameId, profileId) {
    const base = context(gameId, undefined, true);
    const profile = base.state.persistent?.profiles?.[profileId];
    if (!profile || profile.gameId !== gameId || profile.pendingRemove) throw new Error("Target profile is missing or belongs to another game");
    return { ...base, profile };
  }
  function callbackEvent(name, args, timeout = 30000, callbackFirst = false) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(new Error(`${name}: ${error.message || error}`)); else resolve();
      };
      const timer = setTimeout(() => finish(new Error("Timed out; operation outcome may be unknown. Inspect Vortex before retrying.")), timeout);
      try {
        const emitted = callbackFirst ? api.events.emit(name, finish, ...args) : api.events.emit(name, ...args, finish);
        if (emitted === false) finish(new Error("No Vortex handler is available"));
      } catch (error) { finish(error); }
    });
  }
  async function attributes(gameId, id, values) {
    for (const [key, value] of Object.entries(values)) api.store.dispatch(vortex.actions.setModAttribute(gameId, id, key, value));
    const deadline = Date.now() + 5000;
    do {
      const actual = api.getState().persistent?.mods?.[gameId]?.[id]?.attributes || {};
      if (Object.entries(values).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value))) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error("Vortex did not retain the requested attributes");
  }
  async function nexusMetadata(gameId, release, archivePath, fileName) {
    if (typeof api.lookupModMeta !== "function") throw new Error("Vortex metadata lookup is unavailable");
    const queryFileName = fileName || "release.zip";
    const results = await api.lookupModMeta({ fileName: queryFileName, filePath: archivePath,
      fileMD5: release.md5, fileSize: release.size, gameId });
    const candidates = (results || []).map(x => x.value || x);
    const metadata = candidates.find(x => x.source === "nexus"
      && String(x.details?.modId) === String(release.gameScopedModId)
      && String(x.details?.fileId) === String(release.gameScopedFileId)
      && String(x.fileMD5).toLowerCase() === release.md5 && Number(x.fileSizeBytes) === release.size);
    if (!metadata) {
      const observed = candidates.slice(0, 10).map(candidate => ({
        source: candidate?.source ?? null,
        modId: candidate?.details?.modId ?? null,
        fileId: candidate?.details?.fileId ?? null,
        fileMD5: candidate?.fileMD5 ?? null,
        fileSizeBytes: candidate?.fileSizeBytes ?? null,
        fileName: candidate?.fileName ?? null,
      }));
      const expected = { source: "nexus", modId: String(release.gameScopedModId), fileId: String(release.gameScopedFileId),
        fileMD5: release.md5, fileSizeBytes: release.size, fileName: queryFileName };
      const error = new Error(`Vortex cannot yet verify the exact published Nexus archive; expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`);
      error.code = "VDB_RETRYABLE";
      throw error;
    }
    return metadata;
  }

  async function verifiedNexusArchive(gameId, release, archivePath, fileName) {
    const metadata = await nexusMetadata(gameId, release, archivePath, fileName);
    const exactDownload = download => String(download?.fileMD5 || "").toLowerCase() === release.md5
      && Number(download?.size) === release.size;
    const downloads = api.getState().persistent?.downloads?.files || {};
    let downloadId = Object.keys(downloads).find(id => exactDownload(downloads[id]));
    if (!downloadId) downloadId = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Vortex archive import timed out; inspect downloads before retrying")), 120000);
      api.events.emit("import-downloads", [archivePath], ids => {
        clearTimeout(timer);
        if (!Array.isArray(ids) || ids.length !== 1) reject(new Error("Vortex did not return one archive ID")); else resolve(ids[0]);
      }, true);
    });
    const deadline = Date.now() + 30000;
    while (!exactDownload(api.getState().persistent?.downloads?.files?.[downloadId]) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!exactDownload(api.getState().persistent?.downloads?.files?.[downloadId])) {
      throw new Error("Imported archive identity has not been verified after Vortex settled the download record");
    }
    return { metadata, downloadId };
  }
  function linkArchive(gameId, stagedId, downloadId, metadata) {
    api.store.dispatch(vortex.actions.setModArchiveId(gameId, stagedId, downloadId));
    if (vortex.actions.setDownloadInstalled) api.store.dispatch(vortex.actions.setDownloadInstalled(downloadId, gameId, stagedId));
    if (vortex.actions.setDownloadModInfo) api.store.dispatch(vortex.actions.setDownloadModInfo(downloadId, "meta", metadata));
    if (api.getState().persistent?.mods?.[gameId]?.[stagedId]?.archiveId !== downloadId) throw new Error("Vortex did not retain the release archive link");
  }
  return {
    context,
    profileContext,
    profiles(gameId) {
      return Object.values(api.getState().persistent?.profiles || {}).filter(p => p.gameId === gameId && !p.pendingRemove).map(p => p.id).sort();
    },
    async replaceDisabled(gameId, profileId, target, siblings, expected) {
      const { profile } = profileContext(gameId, profileId);
      if (!isDeepStrictEqual(profile.modState || {}, expected)) throw new Error("Profile changed before disabled-version selection");
      if (siblings.some(id => profile.modState?.[id]?.enabled) || profile.modState?.[target]?.enabled) throw new Error("Disabled selection cannot replace an enabled mod");
      if (typeof vortex.actions.setProfile !== "function") throw new Error("Vortex profile update action is unavailable");
      // Transfer the package's existing selection history atomically, never enable it.
      // Older builds stay installed for rollback; only this profile's records move.
      const previous = siblings.map(id => profile.modState[id]).sort((a, b) => (b.enabledTime || 0) - (a.enabledTime || 0))[0] || {};
      const modState = structuredClone(profile.modState || {});
      for (const id of siblings) delete modState[id];
      modState[target] = { ...previous, ...modState[target], enabled: false };
      api.store.dispatch(vortex.actions.setProfile({ id: profileId, modState }));
      if (!isDeepStrictEqual(profileContext(gameId, profileId).profile.modState, modState)) throw new Error("Disabled-version selection did not settle");
    },
    async assertDeploymentReady(gameId, profileId) {
      const { state } = context(gameId, profileId);
      const pending = message => { const error = new Error(message); error.code = "VDB_WAITING"; throw error; };
      const tools = state.session?.base?.toolsRunning;
      if (tools && Object.keys(tools).length) pending("Waiting for running games or tools to close");
      const gameRoot = state.settings?.gameMode?.discovered?.[gameId]?.path;
      const game = vortex.util.getGame(gameId);
      const executable = game?.executable?.(gameRoot);
      if (!gameRoot || typeof executable !== "string" || !executable) pending("Waiting for a known game executable and installation path");
      const { runningProcesses, gameProcess } = require("./processes");
      let processes;
      try { processes = await (options.runningProcesses || runningProcesses)(); }
      catch (error) { pending(`Waiting for game-process verification: ${error.message}`); }
      if (gameProcess(processes, gameRoot, executable)) pending("Waiting for the game to close");
      context(gameId, profileId);
    },
    async register(gameId, mod) {
      await callbackEvent("create-mod", [gameId, mod]);
      if (!api.getState().persistent?.mods?.[gameId]?.[mod.id]) throw new Error("Vortex did not retain the staged mod entry");
    },
    attributes,
    async promote(gameId, stagedId, release, archivePath, logicalFileName) {
      context(gameId);
      const { metadata, downloadId } = await verifiedNexusArchive(gameId, release, archivePath, release.fileName);
      const promotionAttributes = { source: "nexus", modId: Number(release.gameScopedModId), fileId: Number(release.gameScopedFileId),
        downloadGame: gameId, fileMD5: release.md5, fileSize: release.size, vdbPublication: "verified", vdbReleaseVersionId: release.versionId };
      if (logicalFileName !== undefined) promotionAttributes.logicalFileName = logicalFileName;
      await attributes(gameId, stagedId, promotionAttributes);
      linkArchive(gameId, stagedId, downloadId, metadata);
      return { archiveId: downloadId, publication: "verified" };
    },
    async inheritConflicts(gameId, profileId, selections, progress, inactive = false) {
      const getContext = () => inactive ? profileContext(gameId, profileId) : context(gameId, profileId);
      const before = getContext();
      const expected = structuredClone({ mods: before.mods, profiles: before.state.persistent?.profiles });
      const assertUnchanged = () => {
        const current = getContext();
        if (!isDeepStrictEqual({ mods: current.mods, profiles: current.state.persistent?.profiles }, expected)) {
          throw new Error("Vortex mods or profiles changed while planning or applying conflict inheritance; inspect the receipt before recovery");
        }
      };
      const matches = (mod, reference) => {
        if (typeof vortex.util.testModReference !== "function") throw new Error("Vortex rule matching API is unavailable; no conflict rules were changed");
        return vortex.util.testModReference(mod, reference);
      };
      const updates = planConflictInheritance(before, selections, matches);
      if (!updates.length) return;
      if (typeof vortex.actions.setModAttribute !== "function"
          || updates.some(update => update.disposition === "inherited")
            && (typeof vortex.actions.addModRule !== "function" || typeof vortex.actions.setFileOverride !== "function")) {
        throw new Error("Vortex conflict rule actions are unavailable; no conflict rules were changed");
      }
      await progress({ phase: "conflict-inheritance", conflictInheritance: updates });
      assertUnchanged();
      // Mark the whole batch before any rule write. Interrupted applications
      // require inspection rather than guessing whether an empty list is fresh.
      for (const update of updates) {
        await attributes(gameId, update.target, { vdbConflictInheritance: "applying" });
        expected.mods[update.target].attributes.vdbConflictInheritance = "applying";
        assertUnchanged();
      }
      for (const update of updates) {
        assertUnchanged();
        if (update.disposition === "inherited") {
          for (const rule of update.rules) api.store.dispatch(vortex.actions.addModRule(gameId, update.target, rule));
          api.store.dispatch(vortex.actions.setFileOverride(gameId, update.target, update.fileOverrides));
          const actual = api.getState().persistent.mods[gameId][update.target];
          if (!isDeepStrictEqual(actual.rules || [], update.rules) || !isDeepStrictEqual(actual.fileOverrides, update.fileOverrides)) {
            throw new Error("Vortex did not retain the inherited conflict choices; inspect the receipt before recovery");
          }
          if (update.rules.length) expected.mods[update.target].rules = structuredClone(update.rules);
          expected.mods[update.target].fileOverrides = [...update.fileOverrides];
          assertUnchanged();
        }
      }
      for (const update of updates) {
        await attributes(gameId, update.target, { vdbConflictInheritance: "initialized" });
        expected.mods[update.target].attributes.vdbConflictInheritance = "initialized";
        assertUnchanged();
      }
    },
    async activate(gameId, profileId, target, siblings) {
      context(gameId, profileId);
      if (typeof vortex.actions.setModEnabled !== "function") throw new Error("Vortex profile activation action is unavailable");
      const options = { allowAutoDeploy: false, reason: "version_update" };
      for (const id of siblings) api.store.dispatch(vortex.actions.setModEnabled(profileId, id, false));
      if (siblings.length) api.events.emit("mods-enabled", siblings, false, gameId, options);
      api.store.dispatch(vortex.actions.setModEnabled(profileId, target, true));
      api.events.emit("mods-enabled", [target], true, gameId, options);
      const { profile } = context(gameId, profileId);
      if (!profile.modState?.[target]?.enabled || siblings.some(id => profile.modState?.[id]?.enabled)) throw new Error("Profile activation did not settle as requested");
    },
    async deploy(gameId, profileId) {
      context(gameId, profileId);
      // Verified against mod_management/index.ts: callback precedes profileId.
      await callbackEvent("deploy-mods", [profileId, undefined, { manual: true }], 600000, true);
      context(gameId, profileId);
    },
    deploymentRoot(gameId, modType, allowInactive = false) {
      const { state } = context(gameId, undefined, allowInactive);
      const discovery = state.settings?.gameMode?.discovered?.[gameId];
      const game = vortex.util.getGame(gameId);
      const target = discovery?.path && game?.getModPaths(discovery.path)?.[modType || ""];
      if (!target) throw new Error(`No deployment path for mod type '${modType || "default"}'`);
      return target;
    },
    snapshot() {
      const state = api.getState();
      const profile = vortex.selectors.activeProfile(state);
      const gameId = vortex.selectors.activeGameId(state);
      const activeMods = gameId && profile ? Object.entries(state.persistent?.mods?.[gameId] || {})
        .filter(([id]) => !!profile.modState?.[id]?.enabled)
        .map(([id, mod]) => ({ id, type: mod.type, name: mod.attributes?.name, version: mod.attributes?.version,
          source: mod.attributes?.source, modId: mod.attributes?.modId, fileId: mod.attributes?.fileId,
          logicalFileName: mod.attributes?.logicalFileName, vdbProjectId: mod.attributes?.vdbProjectId,
          vdbPackageId: mod.attributes?.vdbPackageId, vdbBuildId: mod.attributes?.vdbBuildId,
          vdbPublication: mod.attributes?.vdbPublication })) : [];
      return { activeGameId: gameId, activeProfileId: profile?.id,
        profiles: Object.values(state.persistent?.profiles || {}).map(p => ({ id: p.id, gameId: p.gameId, name: p.name })),
        games: Object.keys(state.settings?.gameMode?.discovered || {}),
        activeMods,
        managed: Object.entries(state.persistent?.mods || {}).flatMap(([game, mods]) => Object.entries(mods)
          .filter(([, mod]) => mod.attributes?.vdbProjectId)
          .map(([id, mod]) => ({ gameId: game, id, type: mod.type, name: mod.attributes.name, version: mod.attributes.version,
            source: mod.attributes.source, modId: mod.attributes.modId, logicalFileName: mod.attributes.logicalFileName,
            vdbProjectId: mod.attributes.vdbProjectId, vdbPackageId: mod.attributes.vdbPackageId,
            vdbBuildId: mod.attributes.vdbBuildId, vdbPublication: mod.attributes.vdbPublication,
            enabled: game === gameId && !!profile?.modState?.[id]?.enabled }))),
      };
    },
  };
}

module.exports = { createAdapter };
