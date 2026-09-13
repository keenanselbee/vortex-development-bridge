"use strict";

const { isDeepStrictEqual } = require("node:util");
const { currentBuilds } = require("../protocol/intents");

function compareVersions(next, old) {
  const a = /^(\d+)\.(\d+)\.(\d+)$/.exec(next || "");
  const b = /^(\d+)\.(\d+)\.(\d+)(-dev\.[A-Za-z0-9.-]+)?$/.exec(old || "");
  if (!a || !b) return null;
  for (let i = 1; i <= 3; i++) if (BigInt(a[i]) !== BigInt(b[i])) return BigInt(a[i]) > BigInt(b[i]) ? 1 : -1;
  return b[4] ? 1 : 0;
}

async function finish(engine, request, config, progress, siblingsFor, previous) {
  const results = previous ? structuredClone(previous) : {
    staging: "completed", activation: "unchanged", deployment: "not-requested", builds: [], profiles: [], skipped: [], verification: [],
    profileScope: request.payload.profileScope,
  };
  delete results.pending;
  const selections = await currentBuilds(engine.root, request);
  if (!selections.length) return { ...results, superseded: true };
  for (const selection of selections) {
    const pkg = config.packages.find(p => p.id === selection.packageId);
    if (!pkg) throw new Error("Finish includes an unregistered package");
    const staged = await engine.stage({ ...request, packageId: pkg.id,
      payload: { ...selection, stageOnly: true, profileId: null } }, config, pkg, progress);
    const row = { ...staged, packageId: pkg.id, version: selection.version, staging: "completed" };
    results.builds = [...results.builds.filter(b => b.packageId !== pkg.id), row];
  }
  await progress({ phase: "staged", staging: "completed", result: results });
  if (request.payload.stageOnly) return results;
  if (!results.profileIds) {
    results.profileIds = request.payload.profileScope === "all" ? engine.adapter.profiles(config.gameId) : [request.payload.profileId];
    if (results.profileIds.length > 1000) throw new Error("Finish exceeds the 1000-profile limit");
    await progress({ phase: "profiles-selected", result: results });
  }
  for (const profileId of results.profileIds) {
    if (results.profiles.some(p => p.profileId === profileId && p.status === "completed")) continue;
    const record = { profileId, status: "pending", builds: [], verification: [] };
    const save = async step => {
      results.profiles = [...results.profiles.filter(p => p.profileId !== profileId), record];
      await progress({ ...step, result: results });
    };
    if (!engine.adapter.profiles(config.gameId).includes(profileId)) {
      if (request.payload.profileScope === "profile") throw new Error("Explicit target profile is missing or belongs to another game");
      record.status = "completed"; record.reason = "Profile no longer exists for this game";
      await save({ phase: "profile-skipped" }); continue;
    }
    const deploy = [];
    for (const selection of await currentBuilds(engine.root, request, profileId)) {
      const pkg = config.packages.find(p => p.id === selection.packageId);
      const loaded = await engine.loadBuild({ ...request, payload: { buildId: selection.buildId, stageOnly: true } }, config, pkg);
      const context = engine.adapter.profileContext(config.gameId, profileId);
      const siblings = siblingsFor(context, config, pkg, loaded.build.stagedId, true);
      const present = [...siblings, ...(Object.hasOwn(context.profile.modState || {}, loaded.build.stagedId) ? [loaded.build.stagedId] : [])];
      const enabled = present.filter(id => context.profile.modState[id].enabled);
      const row = { packageId: pkg.id, buildId: selection.buildId, stagedId: loaded.build.stagedId,
        enabled: enabled.length > 0, status: "skipped" };
      record.builds.push(row);
      if (!present.length) { row.reason = "Package is absent from this profile"; continue; }
      const versions = (enabled.length ? enabled : siblings).filter(id => id !== loaded.build.stagedId).map(id => context.mods[id].attributes?.version);
      if (versions.some(v => compareVersions(selection.version, v) === null || compareVersions(selection.version, v) <= 0)) {
        row.reason = "An equal, newer, or incomparable version is selected"; continue;
      }
      if (enabled.length) {
        deploy.push({ packageId: pkg.id, buildId: selection.buildId, expected: structuredClone(context.profile.modState), row });
      } else if (siblings.length) {
        const expected = structuredClone(context.profile.modState || {});
        await save({ phase: "disabled-selection-starting", deploymentStarted: true, profileId, previousModState: expected });
        const source = [...siblings].sort((a, b) => (context.profile.modState[b].enabledTime || 0) - (context.profile.modState[a].enabledTime || 0))[0];
        await engine.adapter.inheritConflicts(config.gameId, profileId, [{ target: loaded.build.stagedId, siblings: [source],
          files: loaded.build.files, deploymentRoot: engine.adapter.deploymentRoot(config.gameId, pkg.modType, true) }], progress, true);
        if (!(await currentBuilds(engine.root, request, profileId)).some(b => b.packageId === pkg.id)) throw new Error("Finish superseded during disabled selection; inspect before recovery");
        await engine.adapter.replaceDisabled(config.gameId, profileId, loaded.build.stagedId, siblings, expected);
        row.status = "updated-disabled";
        await save({ phase: "disabled-selected", deploymentStarted: false });
      } else { row.status = "updated-disabled"; }
    }
    if (deploy.length) {
      try {
        await engine.adapter.assertDeploymentReady(config.gameId, profileId);
        await engine.adapter.assertDeploymentReady(config.gameId, profileId);
      }
      catch (error) {
        if (!["VDB_INACTIVE_GAME", "VDB_INACTIVE_PROFILE", "VDB_WAITING"].includes(error.code)) throw error;
        record.reason = error.message;
        for (const item of deploy) item.row.status = "pending";
        await save({ phase: "waiting-profile", deploymentStarted: false }); continue;
      }
      const current = new Set((await currentBuilds(engine.root, request, profileId)).map(b => b.packageId));
      const ready = deploy.filter(b => current.has(b.packageId));
      // Compare enabled membership after asynchronous readiness checks. Disabled
      // updates within this batch legitimately changed only disabled records.
      const enabledIds = state => Object.keys(state).filter(id => state[id].enabled).sort();
      for (const item of ready) if (!isDeepStrictEqual(enabledIds(engine.adapter.profileContext(config.gameId, profileId).profile.modState), enabledIds(item.expected))) throw new Error("Profile changed before final deployment");
      if (ready.length) {
        await save({ phase: "deployment-starting", deploymentStarted: true, profileId });
        const deployed = await engine.deployBatch({ ...request, payload: { profileId,
          expectedEnabled: enabledIds(engine.adapter.profileContext(config.gameId, profileId).profile.modState),
          builds: ready.map(({ packageId, buildId }) => ({ packageId, buildId })) } }, config, progress);
        record.verification = deployed.verification;
        for (const item of ready) item.row.status = "deployed";
        results.verification.push(...deployed.verification.map(v => ({ ...v, profileId })));
        results.activation = "completed";
        if (deployed.verification.some(v => v.deployed !== "verified" || !v.enabled || v.differences?.length)) {
          await save({ phase: "verification-failed" });
          throw new Error("Deployed files differ; inspect the profile receipt before recovery");
        }
      }
    }
    record.status = "completed";
    await save({ phase: "profile-completed", deploymentStarted: false });
  }
  results.pending = results.profiles.some(p => p.status === "pending");
  results.deployment = results.pending ? "pending" : results.verification.length ? "completed" : "not-requested";
  results.skipped = results.profiles.flatMap(p => p.builds.filter(b => b.status === "skipped").map(b => ({ ...b, profileId: p.profileId })));
  return results;
}

module.exports = { finish, compareVersions };
