"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { Engine } = require("../src/extension/engine");
const { createAdapter } = require("../src/extension/adapter");
const client = require("../src/client/client");
const { atomicJson, readJson } = require("../src/protocol/files");
const { receipt } = require("../src/protocol/queue");

async function fixture(t) {
  const parent = path.resolve(".codex-temp/tests");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "engine-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const staging = path.join(root, "staging"), live = path.join(root, "live"), artifact = path.join(root, "artifact"), bridge = path.join(root, "bridge");
  for (const dir of [staging, live, artifact]) await fs.mkdir(dir);
  await fs.writeFile(path.join(artifact, "data.bin"), "first build");
  const config = { schemaVersion: 1, id: "demo", gameId: "example", packages: [{ id: "main", displayName: "Demo", installation: "prepared-directory",
    nexus: { gameDomain: "example", gameScopedModId: "1", groupId: "2" } }] };
  const configPath = path.join(root, "vdb.json");
  await atomicJson(configPath, config);
  await client.register(bridge, configPath);
  const state = { persistent: { mods: { example: {} }, downloads: { files: {} }, profiles: { p1: { id: "p1", name: "Test", gameId: "example", modState: {} } } }, settings: { gameMode: { discovered: { example: { path: live } } } } };
  const events = new EventEmitter();
  let deployments = 0, failDeployment = false;
  events.on("create-mod", (game, mod, cb) => { state.persistent.mods[game][mod.id] = mod; cb(null); });
  events.on("deploy-mods", async (cb, profileId) => {
    assert.equal(profileId, "p1");
    deployments++;
    if (failDeployment) return cb(new Error("fixture deployment failed"));
    try {
      for (const [id, enabled] of Object.entries(state.persistent.profiles.p1.modState)) {
        if (enabled.enabled) await fs.cp(path.join(staging, id), live, { recursive: true });
      }
      cb(null);
    } catch (error) { cb(error); }
  });
  const api = { getState: () => state, lookupModMeta: async () => [], events, store: { dispatch: action => {
    if (action.kind === "enabled") state.persistent.profiles[action.profile].modState[action.id] = { enabled: action.value };
    if (action.kind === "attribute") state.persistent.mods[action.game][action.id].attributes[action.key] = action.value;
    if (action.kind === "archive") state.persistent.mods[action.game][action.id].archiveId = action.archiveId;
    if (action.kind === "rule") {
      const mod = state.persistent.mods[action.game][action.id];
      mod.rules = [...(mod.rules || []), action.rule];
    }
    if (action.kind === "overrides") state.persistent.mods[action.game][action.id].fileOverrides = action.files;
  } } };
  let activeGameId = "example";
  const vortex = { selectors: { activeGameId: () => activeGameId, activeProfile: () => activeGameId === "example" ? state.persistent.profiles.p1 : undefined, installPathForGame: () => staging },
    actions: { setModEnabled: (profile, id, value) => ({ kind: "enabled", profile, id, value }),
      setModAttribute: (game, id, key, value) => ({ kind: "attribute", game, id, key, value }),
      addModRule: (game, id, rule) => ({ kind: "rule", game, id, rule }),
      setFileOverride: (game, id, files) => ({ kind: "overrides", game, id, files }),
      setModArchiveId: (game, id, archiveId) => ({ kind: "archive", game, id, archiveId }) },
    util: { getGame: () => ({ getModPaths: () => ({ "": live }) }),
      testModReference: (mod, ref) => ref.id === mod.id } };
  const engine = new Engine(bridge, createAdapter(api, vortex));
  return { root, bridge, artifact, staging, live, engine, state, api, config, configPath,
    deployments: () => deployments, fail: () => { failDeployment = true; }, activeGame: value => { activeGameId = value; } };
}

test("stage-only packages can stage while another Vortex game is active", async t => {
  const f = await fixture(t);
  f.activeGame("another-game");
  const staged = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, staged.id)).status, "completed");
  assert.equal(f.deployments(), 0);
});

test("stage, deploy, drift detection and rollback preserve independent builds", async t => {
  const f = await fixture(t);
  const first = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, first.id)).status, "completed");
  assert.equal(f.deployments(), 0);
  const stagedRecord = await readJson(path.join(f.bridge, "builds", first.buildId + ".json"));
  const stagedAttributes = f.state.persistent.mods.example[stagedRecord.stagedId].attributes;
  assert.equal(stagedAttributes.source, "other");
  assert.equal(stagedAttributes.logicalFileName, "Demo", "displayName is the safe logical-file-name default");
  assert.equal(stagedAttributes.modId, 1);
  assert.equal(stagedAttributes.vdbNexusFileGroupId, "2");
  assert.equal(stagedAttributes.fileId, undefined, "local bytes must never receive a Nexus file ID");
  const deployment = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: first.buildId, profileId: "p1" });
  await f.engine.tick();
  const result = await receipt(f.bridge, deployment.id);
  assert.equal(result.result.verification.deployed, "verified");
  const status = await readJson(path.join(f.bridge, "status.json"));
  assert.ok(status.capabilities.includes("reconcile"));
  assert.equal(status.activeMods.length, 1);
  assert.equal(status.activeMods[0].vdbBuildId, first.buildId);
  assert.equal(status.managed[0].logicalFileName, "Demo");
  await f.engine.tick();
  assert.equal(f.deployments(), 1, "completed requests must never deploy again");
  await fs.writeFile(path.join(f.artifact, "data.bin"), "second build");
  const second = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  assert.notEqual(first.buildId, second.buildId);
  await f.engine.tick();
  const switchToSecond = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: second.buildId, profileId: "p1" });
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, switchToSecond.id)).status, "completed");
  const rollback = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: first.buildId, profileId: "p1", rollback: true });
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, rollback.id)).status, "completed");
  assert.equal(await fs.readFile(path.join(f.live, "data.bin"), "utf8"), "first build");
  const record = await readJson(path.join(f.bridge, "builds", first.buildId + ".json"));
  await fs.writeFile(path.join(f.staging, record.stagedId, "data.bin"), "unexpected editor save");
  const verify = await client.submit(f.bridge, "demo", "main", "verify", { buildId: first.buildId });
  await f.engine.tick();
  assert.match((await receipt(f.bridge, verify.id)).error, /drift/);
});

test("queued upgrade inherits at activation, journals choices and retains them on rollback", async t => {
  const f = await fixture(t);
  const first = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  const firstBuild = await readJson(path.join(f.bridge, "builds", first.buildId + ".json"));
  const deploy = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: first.buildId, profileId: "p1" });
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, deploy.id)).status, "completed");
  f.state.persistent.mods.example.other = { id: "other", attributes: {} };
  const previous = f.state.persistent.mods.example[firstBuild.stagedId];
  previous.rules = [{ type: "after", reference: { id: "other" } }];
  previous.fileOverrides = [path.join(f.live, "data.bin")];
  await fs.writeFile(path.join(f.artifact, "data.bin"), "next payload");
  const second = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.1");
  await f.engine.tick();
  const secondBuild = await readJson(path.join(f.bridge, "builds", second.buildId + ".json"));
  const next = f.state.persistent.mods.example[secondBuild.stagedId];
  assert.equal(next.rules, undefined, "staging must not inherit or activate");
  const upgrade = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: second.buildId, profileId: "p1" });
  await f.engine.tick();
  const result = await receipt(f.bridge, upgrade.id);
  assert.equal(result.status, "completed");
  assert.equal(result.conflictInheritance[0].source, firstBuild.stagedId);
  assert.deepEqual(next.rules, previous.rules);
  assert.deepEqual(next.fileOverrides, previous.fileOverrides);
  const saved = structuredClone(previous);
  next.rules = [];
  const rollback = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: first.buildId, profileId: "p1", rollback: true });
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, rollback.id)).status, "completed");
  assert.deepEqual(previous, saved);
  assert.deepEqual(next.rules, []);
});

test("canonical logical names group VDB variants without changing ownership", async t => {
  const f = await fixture(t);
  f.config.packages[0].logicalFileName = "Canonical Demo";
  await atomicJson(f.configPath, f.config);
  await client.register(f.bridge, f.configPath);

  const first = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  await fs.writeFile(path.join(f.artifact, "data.bin"), "second build");
  const second = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();

  const firstRecord = await readJson(path.join(f.bridge, "builds", first.buildId + ".json"));
  const secondRecord = await readJson(path.join(f.bridge, "builds", second.buildId + ".json"));
  const firstAttributes = f.state.persistent.mods.example[firstRecord.stagedId].attributes;
  const secondAttributes = f.state.persistent.mods.example[secondRecord.stagedId].attributes;
  assert.notEqual(firstRecord.stagedId, secondRecord.stagedId);
  assert.equal(firstAttributes.logicalFileName, "Canonical Demo");
  assert.equal(secondAttributes.logicalFileName, "Canonical Demo");
  for (const [attributes, buildId] of [[firstAttributes, first.buildId], [secondAttributes, second.buildId]]) {
    assert.equal(attributes.vdbProjectId, "demo");
    assert.equal(attributes.vdbPackageId, "main");
    assert.equal(attributes.vdbBuildId, buildId);
  }
});

test("metadata-only registration changes retain exact completed builds", async t => {
  const f = await fixture(t);
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  f.config.packages[0].logicalFileName = "Canonical Demo";
  await atomicJson(f.configPath, f.config);
  await client.register(f.bridge, f.configPath);

  const verify = await client.submit(f.bridge, "demo", "main", "verify", { buildId: stage.buildId });
  await f.engine.tick();
  const verification = await receipt(f.bridge, verify.id);
  assert.equal(verification.status, "completed");
  assert.equal(verification.result.staged, "verified");

  const reconcile = await client.reconcile(f.bridge, "demo", "main");
  await f.engine.tick();
  const reconciled = await receipt(f.bridge, reconcile.id);
  assert.equal(reconciled.status, "completed");
  assert.equal(reconciled.result.updated.length, 1);
});

test("activation treats an exact Nexus legacy version as an exclusive sibling", async t => {
  const f = await fixture(t);
  f.config.packages[0].logicalFileName = "Canonical Demo";
  await atomicJson(f.configPath, f.config);
  await client.register(f.bridge, f.configPath);
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  f.state.persistent.mods.example.legacy = { id: "legacy", attributes: { logicalFileName: "Canonical Demo", source: "nexus", modId: 1 } };
  f.state.persistent.mods.example.retainedLocal = { id: "retainedLocal", attributes: { logicalFileName: "Canonical Demo", source: "grailwright-local", modId: 1 } };
  f.state.persistent.profiles.p1.modState.legacy = { enabled: true };
  f.state.persistent.profiles.p1.modState.retainedLocal = { enabled: true };
  const build = await readJson(path.join(f.bridge, "builds", stage.buildId + ".json"));
  f.state.persistent.mods.example[build.stagedId].rules = []; // Explicit target choices bypass inheritance.
  let siblings;
  f.engine.adapter.activate = async (_gameId, _profileId, _target, candidates) => { siblings = candidates; };
  f.engine.adapter.deploy = async () => {};
  const request = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: stage.buildId, profileId: "p1" });
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, request.id)).status, "completed");
  assert.deepEqual(siblings, ["legacy", "retainedLocal"]);
  assert.equal(f.state.persistent.profiles.p1.modState.legacy.enabled, true);
});

test("stage and deployment fail closed on an ambiguous logical-name collision", async t => {
  const f = await fixture(t);
  f.config.packages[0].logicalFileName = "Canonical Demo";
  await atomicJson(f.configPath, f.config);
  await client.register(f.bridge, f.configPath);
  f.state.persistent.mods.example.wrong = { id: "wrong", attributes: { logicalFileName: "Canonical Demo", source: "nexus", modId: 99 } };
  const blockedStage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  assert.match((await receipt(f.bridge, blockedStage.id)).error, /Ambiguous logicalFileName/);
  assert.deepEqual(await fs.readdir(f.staging), []);
  delete f.state.persistent.mods.example.wrong;
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  f.state.persistent.mods.example.wrong = { id: "wrong", attributes: { logicalFileName: "Canonical Demo", source: "other" } };
  const blockedDeploy = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: stage.buildId, profileId: "p1" });
  await f.engine.tick();
  assert.match((await receipt(f.bridge, blockedDeploy.id)).error, /Ambiguous logicalFileName/);
  const blockedBatch = await client.submit(f.bridge, "demo", "main", "deploy-batch", { profileId: "p1", builds: [{ packageId: "main", buildId: stage.buildId }] });
  await f.engine.tick();
  assert.match((await receipt(f.bridge, blockedBatch.id)).error, /Ambiguous logicalFileName/);
  assert.equal(f.state.persistent.profiles.p1.modState.wrong, undefined);
});

test("reconcile previews and repairs only exact VDB-owned records", async t => {
  const f = await fixture(t);
  f.config.packages[0].logicalFileName = "Canonical Demo";
  await atomicJson(f.configPath, f.config);
  await client.register(f.bridge, f.configPath);
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  const build = await readJson(path.join(f.bridge, "builds", stage.buildId + ".json"));
  f.state.persistent.mods.example[build.stagedId].attributes.logicalFileName = "vdb:demo:main";
  f.state.persistent.mods.example.other = { id: "other", attributes: { logicalFileName: "vdb:demo:other",
    vdbProjectId: "demo", vdbPackageId: "other", vdbBuildId: "other-build" } };
  f.state.persistent.mods.example.retainedLocal = { id: "retainedLocal", attributes: {
    logicalFileName: "Canonical Demo", source: "grailwright-local", modId: 1 } };
  const request = await client.reconcile(f.bridge, "demo", "main");
  await f.engine.tick();
  const result = await receipt(f.bridge, request.id);
  assert.equal(result.status, "completed");
  assert.ok(result.history.some(entry => entry.phase === "reconcile-preview"));
  assert.deepEqual(result.result.updated, [build.stagedId]);
  assert.equal(f.state.persistent.mods.example[build.stagedId].attributes.logicalFileName, "Canonical Demo");
  assert.equal(f.state.persistent.mods.example.other.attributes.logicalFileName, "vdb:demo:other");
  assert.equal(f.state.persistent.mods.example.retainedLocal.attributes.logicalFileName, "Canonical Demo");
});

test("promotion retains the configured canonical logical name", async t => {
  const f = await fixture(t);
  const { createZip } = require("../src/protocol/archive");
  const { hash, inventory } = require("../src/protocol/files");
  f.config.packages[0].logicalFileName = "Canonical Demo";
  await atomicJson(f.configPath, f.config);
  await client.register(f.bridge, f.configPath);
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  const archive = path.join(f.root, "published.zip");
  await createZip(f.artifact, archive);
  const release = { gameDomain: "example", gameScopedModId: "1", groupId: "2", gameScopedFileId: "3", versionId: "v1", version: "0.1.0",
    archive, sha256: await hash(archive), md5: await hash(archive, "md5"), size: (await fs.stat(archive)).size };
  f.state.persistent.downloads.files.published = { fileMD5: release.md5, size: release.size };
  f.api.lookupModMeta = async () => [{ source: "nexus", details: { modId: 1, fileId: 3 }, fileMD5: release.md5, fileSizeBytes: release.size }];
  await atomicJson(path.join(f.root, "release.json"), release);
  const request = await client.promote(f.bridge, "demo", "main", stage.buildId, path.join(f.root, "release.json"));
  await f.engine.tick();
  const record = await readJson(path.join(f.bridge, "builds", stage.buildId + ".json"));
  const attributes = f.state.persistent.mods.example[record.stagedId].attributes;
  assert.equal((await receipt(f.bridge, request.id)).status, "completed");
  assert.equal(attributes.logicalFileName, "Canonical Demo");
  assert.equal(attributes.vdbProjectId, "demo");
  assert.equal(attributes.vdbPackageId, "main");
  assert.equal(attributes.vdbBuildId, stage.buildId);
  assert.equal(attributes.vdbPublication, "verified");
});

test("profile mismatch and expired requests make no deployments", async t => {
  const f = await fixture(t);
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  const wrong = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: stage.buildId, profileId: "other" });
  await f.engine.tick();
  assert.match((await receipt(f.bridge, wrong.id)).error, /not active/);
  const expired = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: stage.buildId, profileId: "p1" });
  const file = path.join(f.bridge, "requests", expired.id + ".json");
  await atomicJson(file, { ...await readJson(file), expiresAt: "2000-01-01T00:00:00Z" });
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, expired.id)).status, "expired");
  assert.equal(f.deployments(), 0);
});

test("failed deployment retains activation history and is not retried", async t => {
  const f = await fixture(t);
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  f.fail();
  const deployment = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: stage.buildId, profileId: "p1" });
  await f.engine.tick();
  const result = await receipt(f.bridge, deployment.id);
  assert.equal(result.status, "failed");
  assert.equal(result.phase, "deploying");
  assert.ok(result.history.some(x => x.phase === "activating"));
  await f.engine.tick();
  assert.equal(f.deployments(), 1);
});

test("changed project registration invalidates queued requests", async t => {
  const f = await fixture(t);
  const queued = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  f.config.packages[0].displayName = "Different name";
  await atomicJson(f.configPath, f.config);
  await client.register(f.bridge, f.configPath);
  await f.engine.tick();
  assert.match((await receipt(f.bridge, queued.id)).error, /configuration changed/);
  assert.deepEqual(await fs.readdir(f.staging), []);
});

test("release promotion requires matching package identity and exact archive payload", async t => {
  const f = await fixture(t);
  const { createZip } = require("../src/protocol/archive");
  const { hash, inventory } = require("../src/protocol/files");
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  const archive = path.join(f.root, "release.zip");
  await createZip(f.artifact, archive);
  const release = { gameDomain: "example", gameScopedModId: "1", groupId: "2", gameScopedFileId: "3", versionId: "v1", version: "0.1.0",
    archive, sha256: await hash(archive), md5: await hash(archive, "md5"), size: (await fs.stat(archive)).size, files: await inventory(f.artifact) };
  const file = path.join(f.root, "release.json");
  await atomicJson(file, release);
  let promoted = 0;
  f.engine.adapter.promote = async () => { promoted++; return { publication: "verified" }; };
  const request = await client.promote(f.bridge, "demo", "main", stage.buildId, file);
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, request.id)).status, "completed");
  assert.equal(promoted, 1);
  await atomicJson(file, { ...release, groupId: "another-page" });
  const invalid = await client.promote(f.bridge, "demo", "main", stage.buildId, file);
  await f.engine.tick();
  assert.match((await receipt(f.bridge, invalid.id)).error, /Nexus identity/);
  assert.equal(promoted, 1);
});

test("promotion queued before its stage waits and completes after the exact build", async t => {
  const f = await fixture(t);
  const { createZip } = require("../src/protocol/archive");
  const { hash, inventory } = require("../src/protocol/files");
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  const archive = path.join(f.root, "release-before-stage.zip");
  await createZip(f.artifact, archive);
  const release = { gameDomain: "example", gameScopedModId: "1", groupId: "2", gameScopedFileId: "3", versionId: "v1", version: "0.1.0",
    archive, sha256: await hash(archive), md5: await hash(archive, "md5"), size: (await fs.stat(archive)).size, files: await inventory(f.artifact) };
  const releasePath = path.join(f.root, "release-before-stage.json");
  await atomicJson(releasePath, release);
  const promotion = await client.promote(f.bridge, "demo", "main", stage.buildId, releasePath);
  f.engine.adapter.promote = async () => ({ publication: "verified" });

  await f.engine.process(path.join(f.bridge, "requests", promotion.id + ".json"));
  assert.equal((await receipt(f.bridge, promotion.id)).status, "pending");
  assert.match((await receipt(f.bridge, promotion.id)).error, /not available yet/);
  await f.engine.process(path.join(f.bridge, "requests", stage.id + ".json"));
  await f.engine.process(path.join(f.bridge, "requests", promotion.id + ".json"));
  assert.equal((await receipt(f.bridge, promotion.id)).status, "completed");
});

test("promotion retries inactive-game and metadata-indexing conditions without duplicate effects", async t => {
  const f = await fixture(t);
  const { createZip } = require("../src/protocol/archive");
  const { hash, inventory } = require("../src/protocol/files");
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  const archive = path.join(f.root, "retryable-release.zip");
  await createZip(f.artifact, archive);
  const release = { gameDomain: "example", gameScopedModId: "1", groupId: "2", gameScopedFileId: "3", versionId: "v1", version: "0.1.0",
    archive, sha256: await hash(archive), md5: await hash(archive, "md5"), size: (await fs.stat(archive)).size, files: await inventory(f.artifact) };
  const releasePath = path.join(f.root, "retryable-release.json");
  await atomicJson(releasePath, release);
  let attempts = 0, effects = 0;
  f.engine.adapter.promote = async () => {
    attempts++;
    if (attempts === 1) {
      const error = new Error("metadata is still indexing");
      error.code = "VDB_RETRYABLE";
      throw error;
    }
    effects++;
    return { publication: "verified" };
  };
  f.activeGame("another-game");
  const promotion = await client.promote(f.bridge, "demo", "main", stage.buildId, releasePath);
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, promotion.id)).status, "pending");
  assert.equal(attempts, 0);
  f.activeGame("example");
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, promotion.id)).status, "pending");
  assert.equal(attempts, 1);
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, promotion.id)).status, "completed");
  assert.equal(attempts, 2);
  assert.equal(effects, 1);
});

test("missing Nexus metadata is tagged as a retryable pre-effect condition", async () => {
  const state = { persistent: { mods: { example: {} } }, settings: { gameMode: { discovered: { example: { path: "live" } } } } };
  const api = { getState: () => state, lookupModMeta: async () => [], events: new EventEmitter(), store: { dispatch: () => {} } };
  const vortex = { selectors: { activeGameId: () => "example", activeProfile: () => undefined, installPathForGame: () => "staging" }, actions: {}, util: {} };
  const adapter = createAdapter(api, vortex);
  await assert.rejects(
    adapter.promote("example", "stage", { md5: "1".repeat(32), size: 1, gameScopedModId: "1", gameScopedFileId: "2" }, "archive.zip"),
    error => error.code === "VDB_RETRYABLE"
      && /cannot yet verify the exact published Nexus archive/.test(error.message)
      && /observed=\[\]/.test(error.message));
});

test("a running receipt from a stopped consumer becomes interrupted", async t => {
  const f = await fixture(t);
  const staged = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  const file = path.join(f.bridge, "receipts", staged.id + ".json");
  const original = await readJson(file);
  await atomicJson(file, { ...original, status: "running" });
  await new Engine(f.bridge, f.engine.adapter).tick();
  assert.equal((await receipt(f.bridge, staged.id)).status, "interrupted");
  assert.equal(f.deployments(), 0);
});

test("batch deployment validates all packages before activating and deploys once", async t => {
  const f = await fixture(t);
  f.config.packages.push({ id: "textures", displayName: "Textures", installation: "prepared-directory" });
  await atomicJson(f.configPath, f.config);
  await client.register(f.bridge, f.configPath);
  const main = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  const texturesRoot = path.join(f.root, "textures");
  await fs.mkdir(texturesRoot);
  await fs.writeFile(path.join(texturesRoot, "texture.bin"), "texture");
  const textures = await client.stage(f.bridge, "demo", "textures", texturesRoot, "0.1.0");
  await f.engine.tick();
  const builds = [{ packageId: "main", buildId: main.buildId }, { packageId: "textures", buildId: textures.buildId }];
  const bad = await client.submit(f.bridge, "demo", "main", "deploy-batch", { profileId: "p1", builds: [...builds, builds[0]] });
  await f.engine.tick();
  assert.match((await receipt(f.bridge, bad.id)).error, /multiple builds/);
  assert.deepEqual(f.state.persistent.profiles.p1.modState, {});
  const good = await client.submit(f.bridge, "demo", "main", "deploy-batch", { profileId: "p1", builds });
  await f.engine.tick();
  const result = await receipt(f.bridge, good.id);
  assert.equal(result.status, "completed");
  assert.equal(result.result.verification.length, 2);
  assert.equal(result.conflictInheritance.length, 2);
  assert.ok(result.conflictInheritance.every(update => update.disposition === "inherited"));
  assert.equal(f.deployments(), 1);
});

test("normal promotion waits for exact imported bytes and rejects unattributed metadata", async t => {
  const f = await fixture(t);
  const { createZip } = require("../src/protocol/archive");
  const { hash } = require("../src/protocol/files");
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  const archive = path.join(f.root, "published.zip");
  await createZip(f.artifact, archive);
  const release = { gameDomain: "example", gameScopedModId: "1", groupId: "2", gameScopedFileId: "3",
    versionId: "v1", version: "0.1.0", fileName: "Published Demo.zip", archive,
    sha256: await hash(archive), md5: await hash(archive, "md5"), size: (await fs.stat(archive)).size };
  const releasePath = path.join(f.root, "published.json");
  await atomicJson(releasePath, release);
  const record = await readJson(path.join(f.bridge, "builds", stage.buildId + ".json"));
  const mod = f.state.persistent.mods.example[record.stagedId];
  const before = structuredClone(mod);
  let imports = 0;
  f.api.events.on("import-downloads", (paths, done) => {
    imports++;
    assert.equal(path.basename(paths[0]), `vdb-${release.sha256}.zip`);
    assert.deepEqual(mod, before, "metadata must wait for the imported archive fingerprint");
    done(["delayed"]);
    setTimeout(() => {
      f.state.persistent.downloads.files.delayed = { fileMD5: release.md5, size: release.size };
    }, 25);
  });
  f.api.lookupModMeta = async () => [{ fileMD5: release.md5, fileSizeBytes: release.size }];
  const request = await client.promote(f.bridge, "demo", "main", stage.buildId, releasePath);
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, request.id)).status, "pending");
  assert.equal(imports, 0, "normal promotion cannot use the retired attribution exception");
  assert.deepEqual(mod, before);
  f.api.lookupModMeta = async query => {
    assert.equal(query.fileName, release.fileName);
    return [{ source: "nexus", details: { modId: 1, fileId: 3 }, fileMD5: release.md5, fileSizeBytes: release.size }];
  };
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, request.id)).status, "completed");
  assert.equal(mod.archiveId, "delayed");
  assert.equal(mod.attributes.vdbPublication, "verified");
  assert.equal(mod.attributes.vdbBuildId, stage.buildId);
  await f.engine.tick();
  assert.equal(imports, 1);
  assert.equal(f.deployments(), 0);
});

test("retired migration requests cannot mutate Vortex or erase historical receipts", async t => {
  const f = await fixture(t);
  const { makeRequest } = require("../src/protocol/queue");
  const { fingerprint } = require("../src/protocol/files");
  const registration = await client.registered(f.bridge, "demo");
  const stateBefore = structuredClone(f.state);
  for (const operation of ["legacy-publication-dry-run", "legacy-publication-apply"]) {
    const request = { ...makeRequest(registration, "main", "verify", {}), operation };
    await atomicJson(path.join(f.bridge, "requests", request.id + ".json"), request);
    const completedRequest = { ...makeRequest(registration, "main", "verify", {}), operation };
    await atomicJson(path.join(f.bridge, "requests", completedRequest.id + ".json"), completedRequest);
    const completed = { id: completedRequest.id, requestHash: fingerprint(completedRequest),
      projectId: "demo", packageId: "main", operation, status: "completed", result: { action: "applied" } };
    const completedPath = path.join(f.bridge, "receipts", completedRequest.id + ".json");
    await atomicJson(completedPath, completed);
    await f.engine.tick();
    assert.equal((await receipt(f.bridge, request.id)).status, "failed");
    assert.match((await receipt(f.bridge, request.id)).error, /Unsupported request protocol or operation/);
    assert.deepEqual(await receipt(f.bridge, completedRequest.id), completed);
  }
  assert.deepEqual(f.state, stateBefore);
  const stage = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, stage.id)).status, "completed");
  const status = await client.status(f.bridge);
  assert.ok(!status.capabilities.some(operation => operation.startsWith("legacy-publication-")));
});

module.exports = { fixture };
