"use strict";

const { currentBuilds } = require("../protocol/intents");

function compareVersions(a, b) {
  // Automatic updates deliberately exclude prereleases; explicit deployment supports them.
  if (!/^\d+\.\d+\.\d+$/.test(a || "") || !/^\d+\.\d+\.\d+$/.test(b || "")) return null;
  const left = a.split(".").map(BigInt), right = b.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

async function finish(engine, request, config, progress, siblingsFor) {
  let selections = await currentBuilds(engine.root, request);
  const results = { staging: "completed", activation: "unchanged", deployment: "not-requested", builds: [], skipped: [] };
  if (!selections.length) return { ...results, superseded: true };
  for (const selection of selections) {
    const pkg = config.packages.find(p => p.id === selection.packageId);
    if (!pkg) throw new Error("Finish includes an unregistered package");
    // Finish owns activation; neither a saved legacy policy nor a supplied profile
    // may cause this staging phase to enable or deploy anything.
    const staged = await engine.stage({ ...request, packageId: pkg.id,
      payload: { ...selection, stageOnly: true, profileId: null } }, config, pkg, progress);
    results.builds.push({ ...staged, packageId: pkg.id, version: selection.version, staging: "completed" });
  }
  await progress({ phase: "staged", staging: "completed", result: results });
  if (request.payload.stageOnly) return results;

  const profileId = request.payload.profileId;
  await engine.adapter.assertDeploymentReady(config.gameId, profileId);
  // Supersession may have happened during a large copy. Retain staged bytes but
  // deploy only the newest intent for each package/profile.
  selections = await currentBuilds(engine.root, request);
  const deploy = [], expected = [];
  for (const selection of selections) {
    const pkg = config.packages.find(p => p.id === selection.packageId);
    const loaded = await engine.loadBuild({ ...request, payload: { buildId: selection.buildId, profileId } }, config, pkg);
    const siblings = siblingsFor(loaded.context, config, pkg, loaded.build.stagedId);
    const enabled = [...siblings, ...(loaded.context.profile.modState?.[loaded.build.stagedId]?.enabled ? [loaded.build.stagedId] : [])];
    if (!enabled.length) {
      results.skipped.push({ packageId: pkg.id, reason: "No version is enabled in the target profile; the new build remains staged. Use explicit deployment to enable it." });
      continue;
    }
    const otherVersions = siblings.map(id => loaded.context.mods[id].attributes?.version);
    if (otherVersions.some(version => compareVersions(selection.version, version) === null || compareVersions(selection.version, version) <= 0)) {
      results.skipped.push({ packageId: pkg.id, reason: "An equal, newer, or incomparable version is selected; use explicit deployment to replace it." });
      continue;
    }
    expected.push({ pkg, stagedId: loaded.build.stagedId, enabled: enabled.sort() });
    deploy.push({ packageId: pkg.id, buildId: selection.buildId });
  }
  if (!deploy.length) return results;

  // This is the last safe waiting boundary. Any subsequent failure requires
  // inspection: conflict inheritance, activation, and deployment are not atomic.
  await engine.adapter.assertDeploymentReady(config.gameId, profileId);
  const latest = new Set((await currentBuilds(engine.root, request)).map(b => b.packageId));
  const finalBuilds = deploy.filter(b => latest.has(b.packageId));
  if (!finalBuilds.length) return { ...results, superseded: true };
  for (const item of expected.filter(x => latest.has(x.pkg.id))) {
    const context = engine.adapter.context(config.gameId, profileId);
    const enabled = [...siblingsFor(context, config, item.pkg, item.stagedId), ...(context.profile.modState?.[item.stagedId]?.enabled ? [item.stagedId] : [])].sort();
    if (JSON.stringify(enabled) !== JSON.stringify(item.enabled)) throw new Error("Profile selection changed during finalization; submit a fresh finish after review");
  }
  await progress({ phase: "deployment-starting", deploymentStarted: true });
  const deployed = await engine.deployBatch({ ...request, payload: { builds: finalBuilds, profileId } }, config, progress);
  return { ...results, ...deployed, activation: "completed" };
}

module.exports = { finish, compareVersions };
