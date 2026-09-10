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
  const config = { schemaVersion: 1, id: "demo", gameId: "example", packages: [{ id: "main", displayName: "Demo", installation: "prepared-directory" }] };
  const configPath = path.join(root, "vdb.json");
  await atomicJson(configPath, config);
  await client.register(bridge, configPath);
  const state = { persistent: { mods: { example: {} }, profiles: { p1: { id: "p1", name: "Test", gameId: "example", modState: {} } } }, settings: { gameMode: { discovered: { example: { path: live } } } } };
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
  const api = { getState: () => state, events, store: { dispatch: action => {
    if (action.kind === "enabled") state.persistent.profiles[action.profile].modState[action.id] = { enabled: action.value };
    if (action.kind === "attribute") state.persistent.mods[action.game][action.id].attributes[action.key] = action.value;
  } } };
  const vortex = { selectors: { activeGameId: () => "example", activeProfile: () => state.persistent.profiles.p1, installPathForGame: () => staging },
    actions: { setModEnabled: (profile, id, value) => ({ kind: "enabled", profile, id, value }),
      setModAttribute: (game, id, key, value) => ({ kind: "attribute", game, id, key, value }) },
    util: { getGame: () => ({ getModPaths: () => ({ "": live }) }) } };
  const engine = new Engine(bridge, createAdapter(api, vortex));
  return { root, bridge, artifact, staging, live, engine, state, config, configPath,
    deployments: () => deployments, fail: () => { failDeployment = true; } };
}

test("stage, deploy, drift detection and rollback preserve independent builds", async t => {
  const f = await fixture(t);
  const first = await client.stage(f.bridge, "demo", "main", f.artifact, "0.1.0");
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, first.id)).status, "completed");
  assert.equal(f.deployments(), 0);
  const deployment = await client.submit(f.bridge, "demo", "main", "deploy", { buildId: first.buildId, profileId: "p1" });
  await f.engine.tick();
  const result = await receipt(f.bridge, deployment.id);
  assert.equal(result.result.verification.deployed, "verified");
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

module.exports = { fixture };
