"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { Engine } = require("../src/extension/engine");
const { createAdapter } = require("../src/extension/adapter");
const client = require("../src/client/client");
const { receipt, validateRequest } = require("../src/protocol/queue");
const { cancel } = require("../src/protocol/intents");
const { atomicJson, readJson } = require("../src/protocol/files");
const { main, outcomeCode } = require("../src/client/cli");

async function fixture(t) {
  const parent = path.resolve(".codex-temp/tests");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "finish-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bridge = path.join(root, "bridge"), staging = path.join(root, "staging"), live = path.join(root, "live");
  await fs.mkdir(staging); await fs.mkdir(live);
  const config = { schemaVersion: 1, id: "demo", gameId: "game", packages: ["one", "two"].map(id => ({
    id, displayName: id, installation: "prepared-directory", activation: "replace-enabled-version",
    nexus: { gameDomain: "game", gameScopedModId: id === "one" ? "1" : "2", groupId: "10" },
  })) };
  const configPath = path.join(root, "vdb.json");
  await atomicJson(configPath, config); await client.register(bridge, configPath);
  const profile = { id: "p1", gameId: "game", modState: {} };
  const state = { persistent: { mods: { game: {} }, profiles: { p1: profile } },
    settings: { gameMode: { discovered: { game: { path: live } } } }, session: { base: { toolsRunning: {} } } };
  for (const pkg of config.packages) {
    const id = "old-" + pkg.id;
    state.persistent.mods.game[id] = { id, installationPath: id, attributes: { name: pkg.id, version: "1.0.0", source: "nexus", modId: pkg.nexus.gameScopedModId, logicalFileName: pkg.id } };
    profile.modState[id] = { enabled: true };
    await fs.mkdir(path.join(staging, id));
  }
  const events = new EventEmitter();
  let deployments = 0, failed = false, activeGame = "game", activeProfile = profile, running = [], checks = 0, beforeCheck;
  events.on("create-mod", (game, mod, cb) => { state.persistent.mods[game][mod.id] = mod; cb(null); });
  events.on("deploy-mods", async cb => {
    deployments++;
    if (failed) return cb(new Error("Uncertain deployment"));
    try {
      for (const [id, enabled] of Object.entries(activeProfile.modState)) if (enabled.enabled) await fs.cp(path.join(staging, id), live, { recursive: true });
      cb(null);
    } catch (error) { cb(error); }
  });
  const api = { getState: () => state, events, store: { dispatch(action) {
    if (action.type === "enable") state.persistent.profiles[action.profileId].modState[action.id] = { enabled: action.enabled };
    if (action.type === "profile") Object.assign(state.persistent.profiles[action.value.id], action.value);
    if (action.type === "attr") state.persistent.mods.game[action.id].attributes[action.key] = action.value;
    if (action.type === "rule") {
      const mod = state.persistent.mods.game[action.id]; mod.rules = [...(mod.rules || []), action.rule];
    }
    if (action.type === "override") state.persistent.mods.game[action.id].fileOverrides = action.files;
  } } };
  const vortex = { selectors: { activeGameId: () => activeGame, activeProfile: () => activeProfile, installPathForGame: () => staging },
    actions: { setModEnabled: (profileId, id, enabled) => ({ type: "enable", profileId, id, enabled }),
      setProfile: value => ({ type: "profile", value }),
      setModAttribute: (g, id, key, value) => ({ type: "attr", id, key, value }),
      addModRule: (g, id, rule) => ({ type: "rule", id, rule }), setFileOverride: (g, id, files) => ({ type: "override", id, files }) },
    util: { getGame: () => ({ executable: () => "game.exe", getModPaths: () => ({ "": live }) }), testModReference: (mod, ref) => mod.id === ref.id } };
  const adapter = createAdapter(api, vortex, { runningProcesses: async () => { checks++; if (beforeCheck) await beforeCheck(checks); return running; } });
  const engine = new Engine(bridge, adapter);
  async function selection(packageId = "one", version = "1.0.1") {
    const artifact = path.join(root, packageId + version); await fs.mkdir(artifact, { recursive: true });
    await fs.writeFile(path.join(artifact, packageId + ".bin"), version);
    return { packageId, version, artifact };
  }
  return { root, bridge, staging, live, state, profile, config, engine, adapter, selection,
    active: (game, p = profile) => { activeGame = game; activeProfile = p; },
    running: value => { running = value; }, beforeCheck: value => { beforeCheck = value; },
    fail: () => { failed = true; }, deployments: () => deployments };
}

test("finish survives offline days, stages immutable bytes, upgrades legacy siblings and deploys once", async t => {
  const f = await fixture(t), s = await f.selection();
  const job = await client.finish(f.bridge, "demo", [s], "p1");
  const request = await readJson(path.join(f.bridge, "requests", job.id + ".json"));
  assert.equal(validateRequest(request, Date.now() + 7 * 86400000), request);
  await fs.writeFile(path.join(s.artifact, "one.bin"), "later source edit");
  await f.engine.tick();
  const result = await receipt(f.bridge, job.id);
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.result.verification[0].deployed, "verified");
  assert.equal(f.profile.modState["old-one"].enabled, false);
  assert.equal(await fs.readFile(path.join(f.live, "one.bin"), "utf8"), "1.0.1");
  await f.engine.tick(); assert.equal(f.deployments(), 1);
});

test("all-profile default updates disabled history, leaves absent profiles alone and resumes active deployments once", async t => {
  const f = await fixture(t);
  const profiles = f.state.persistent.profiles;
  profiles.p2 = { id: "p2", gameId: "game", modState: { "old-one": { enabled: false, enabledTime: 123 }, unrelated: { enabled: true } } };
  profiles.p3 = { id: "p3", gameId: "game", modState: {} };
  profiles.p4 = { id: "p4", gameId: "game", modState: { "old-one": { enabled: true } } };
  profiles.other = { id: "other", gameId: "other", modState: { "old-one": { enabled: true } } };
  const other = structuredClone(profiles.other), absent = structuredClone(profiles.p3);
  const job = await client.finish(f.bridge, "demo", [await f.selection()]);
  assert.equal(job.profileScope, "all");
  await f.engine.tick();
  let result = await receipt(f.bridge, job.id);
  assert.equal(result.status, "pending", result.error);
  const target = result.result.builds[0].stagedId;
  assert.deepEqual(profiles.p2.modState[target], { enabled: false, enabledTime: 123 });
  assert.equal(Object.hasOwn(profiles.p2.modState, "old-one"), false);
  assert.deepEqual(profiles.p2.modState.unrelated, { enabled: true });
  assert.deepEqual(profiles.p3, absent); assert.deepEqual(profiles.other, other);
  assert.equal(f.deployments(), 1);
  await f.engine.tick(); assert.equal(f.deployments(), 1);
  f.active("game", profiles.p4); await f.engine.tick();
  result = await receipt(f.bridge, job.id);
  assert.equal(result.status, "completed", result.error); assert.equal(f.deployments(), 2);
  assert.equal(profiles.p4.modState[target].enabled, true);
  await f.engine.tick(); assert.equal(f.deployments(), 2);
});

test("disabled development versions move to regular versions without activation, deployment or process checks", async t => {
  const f = await fixture(t);
  f.profile.modState["old-one"] = { enabled: false, enabledTime: 50 };
  f.state.persistent.mods.game["old-one"].attributes.version = "0.0.0-dev.20260911-gameplay";
  f.active("elsewhere", { id: "other", gameId: "other" });
  f.beforeCheck(() => { throw new Error("Disabled update must not probe deployment readiness"); });
  const job = await client.finish(f.bridge, "demo", [await f.selection()]);
  await f.engine.tick();
  const result = await receipt(f.bridge, job.id);
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.result.profiles[0].builds[0].status, "updated-disabled");
  assert.equal(f.profile.modState[result.result.builds[0].stagedId].enabled, false);
  assert.equal(f.deployments(), 0); assert.deepEqual(await fs.readdir(f.live), []);
});

test("newer explicit scope supersedes an all-profile request only in the named profile", async t => {
  const f = await fixture(t);
  const p2 = { id: "p2", gameId: "game", modState: { "old-one": { enabled: false } } };
  f.state.persistent.profiles.p2 = p2;
  const all = await client.finish(f.bridge, "demo", [await f.selection()]);
  const one = await client.finish(f.bridge, "demo", [await f.selection("one", "1.0.2")], "p2");
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, all.id)).status, "completed");
  const result = await receipt(f.bridge, one.id);
  assert.equal(result.status, "completed", result.error);
  assert.equal(p2.modState[result.result.builds[0].stagedId].enabled, false);
  assert.equal(await fs.readFile(path.join(f.live, "one.bin"), "utf8"), "1.0.1");
});

test("disabling a pending enabled package is respected when its profile becomes active", async t => {
  const f = await fixture(t);
  f.active("other", { id: "other", gameId: "other" });
  const job = await client.finish(f.bridge, "demo", [await f.selection()]);
  await f.engine.tick();
  f.profile.modState["old-one"].enabled = false;
  f.active("game"); await f.engine.tick();
  const result = await receipt(f.bridge, job.id);
  assert.equal(result.status, "completed", result.error);
  assert.equal(f.profile.modState[result.result.builds[0].stagedId].enabled, false);
  assert.equal(f.deployments(), 0);
});

test("a manual disable during the last deployment checks cannot be re-enabled by finalization", async t => {
  const f = await fixture(t);
  f.beforeCheck(count => { if (count === 3) f.profile.modState["old-one"].enabled = false; });
  const job = await client.finish(f.bridge, "demo", [await f.selection()]);
  await f.engine.tick();
  const result = await receipt(f.bridge, job.id);
  assert.equal(result.status, "failed");
  assert.match(result.error, /enabled state changed/);
  assert.equal(f.profile.modState["old-one"].enabled, false);
  assert.equal(f.deployments(), 0);
  const target = result.result.builds[0].stagedId;
  assert.notEqual(f.profile.modState[target]?.enabled, true);
});

test("retained protocol-2 explicit-profile requests still execute with their original semantics", async t => {
  const f = await fixture(t);
  const job = await client.finish(f.bridge, "demo", [await f.selection()], "p1");
  const file = path.join(f.bridge, "requests", job.id + ".json");
  const request = await readJson(file);
  request.protocolVersion = 2; delete request.payload.profileScope;
  await atomicJson(file, request);
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, job.id)).status, "completed");
  assert.equal(f.deployments(), 1);
});

test("explicit stage-only overrides automatic legacy policy and needs no active game, profile or process probe", async t => {
  const f = await fixture(t); f.active("elsewhere", undefined);
  f.beforeCheck(() => { throw new Error("Stage-only must not inspect processes"); });
  const before = structuredClone(f.profile.modState);
  const s = await f.selection();
  const job = await main(["finish", "--bridge", f.bridge, "--project", "demo", "--package", "one", "--artifact", s.artifact, "--version", s.version, "--stage-only"]);
  await f.engine.tick();
  const result = await receipt(f.bridge, job.id);
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.result.deployment, "not-requested");
  assert.deepEqual(f.profile.modState, before);
  assert.equal(f.deployments(), 0); assert.deepEqual(await fs.readdir(f.live), []);
});

test("inactive profiles and running games keep a finish waiting, then resume without changing context", async t => {
  const f = await fixture(t), s = await f.selection();
  f.active("elsewhere", { id: "p2", gameId: "elsewhere" });
  const job = await client.finish(f.bridge, "demo", [s], "p1");
  await f.engine.tick();
  assert.equal((await receipt(f.bridge, job.id)).status, "pending");
  assert.equal((await receipt(f.bridge, job.id)).staging, "completed");
  f.active("game", { id: "p2", gameId: "game" }); await f.engine.tick();
  assert.match((await receipt(f.bridge, job.id)).error, /profile/);
  f.active("game"); f.running([{ Name: "game.exe", ExecutablePath: path.join(f.live, "game.exe") }]);
  await f.engine.tick(); assert.match((await receipt(f.bridge, job.id)).error, /game to close/);
  assert.equal(f.profile.modState["old-one"].enabled, true); assert.equal(f.deployments(), 0);
  f.running([]); await f.engine.tick();
  assert.equal((await receipt(f.bridge, job.id)).status, "completed"); assert.equal(f.deployments(), 1);
});

test("newer pending builds supersede only overlapping packages and a batch deploys once", async t => {
  const f = await fixture(t);
  const older = await client.finish(f.bridge, "demo", [await f.selection("one"), await f.selection("two")], "p1");
  const newer = await client.finish(f.bridge, "demo", [await f.selection("one", "1.0.2")], "p1");
  await f.engine.tick();
  assert.equal(await fs.readFile(path.join(f.live, "one.bin"), "utf8"), "1.0.2");
  assert.equal(await fs.readFile(path.join(f.live, "two.bin"), "utf8"), "1.0.1");
  assert.equal((await receipt(f.bridge, older.id)).result.verification.length, 1);
  assert.equal((await receipt(f.bridge, newer.id)).status, "completed");
  const batch = await client.finish(f.bridge, "demo", [await f.selection("one", "1.0.3"), await f.selection("two", "1.0.3")], "p1");
  const before = f.deployments(); await f.engine.tick();
  assert.equal(f.deployments(), before + 1);
  assert.equal((await receipt(f.bridge, batch.id)).result.verification.length, 2);
});

test("disabled mods and manually selected newer versions remain selected without automatic downgrade", async t => {
  const f = await fixture(t);
  f.profile.modState["old-one"].enabled = false;
  f.state.persistent.mods.game["old-two"].attributes.version = "2.0.0";
  const job = await client.finish(f.bridge, "demo", [await f.selection("one"), await f.selection("two")], "p1");
  await f.engine.tick();
  const result = await receipt(f.bridge, job.id);
  assert.equal(result.status, "completed", result.error); assert.equal(result.result.skipped.length, 1);
  assert.equal(result.result.deployment, "not-requested"); assert.equal(f.deployments(), 0);
});

test("pending cancellation persists and stage-only does not cancel separately authorized deployment", async t => {
  const f = await fixture(t), s = await f.selection();
  const deploy = await client.finish(f.bridge, "demo", [s], "p1");
  const stage = await client.finish(f.bridge, "demo", [s], undefined, true);
  await cancel(f.bridge, deploy.id); await f.engine.tick();
  assert.equal((await receipt(f.bridge, deploy.id)).status, "cancelled");
  assert.equal((await receipt(f.bridge, stage.id)).status, "completed"); assert.equal(f.deployments(), 0);
  await assert.rejects(cancel(f.bridge, stage.id), /started or finished/);
});

test("uncertain or interrupted deployments are terminal and never automatically retried", async t => {
  const f = await fixture(t); f.fail();
  const job = await client.finish(f.bridge, "demo", [await f.selection()], "p1");
  await f.engine.tick(); assert.equal((await receipt(f.bridge, job.id)).status, "failed");
  await f.engine.tick(); assert.equal(f.deployments(), 1);
  const file = path.join(f.bridge, "receipts", job.id + ".json");
  const previous = await readJson(file); await atomicJson(file, { ...previous, status: "running" });
  await f.engine.tick(); assert.equal((await receipt(f.bridge, job.id)).status, "interrupted");
  assert.equal(f.deployments(), 1);
});

test("game starting during final preflight blocks activation and unknown process state waits", async t => {
  const f = await fixture(t);
  f.beforeCheck(count => { if (count >= 2) f.running([{ Name: "game.exe", ExecutablePath: null }]); });
  const job = await client.finish(f.bridge, "demo", [await f.selection()], "p1");
  await f.engine.tick(); assert.equal((await receipt(f.bridge, job.id)).status, "pending");
  assert.equal(f.profile.modState["old-one"].enabled, true); assert.equal(f.deployments(), 0);
  f.beforeCheck(() => { throw new Error("Unavailable process inventory"); });
  await f.engine.tick(); assert.match((await receipt(f.bridge, job.id)).error, /process verification/);
});

test("old running consumers and malformed finish batches are rejected before queueing", async t => {
  const f = await fixture(t), s = await f.selection();
  await atomicJson(path.join(f.bridge, "status.json"), { observedAt: new Date().toISOString(), capabilities: ["stage"] });
  await assert.rejects(client.finish(f.bridge, "demo", [s], "p1"), /Update the extension/);
  await assert.rejects(client.finish(f.bridge, "demo", [s, s], "p1"), /multiple builds/);
  await assert.rejects(client.finish(f.bridge, "demo", [s], "*"), /profile/);
  assert.equal(outcomeCode({ status: "pending", staging: "completed" }), 2);
  await assert.rejects(fs.stat(path.join(f.bridge, "requests")), { code: "ENOENT" });
});

test("a later bad batch artifact prevents any queue submission and staged drift prevents any activation", async t => {
  const f = await fixture(t), one = await f.selection(), two = await f.selection("two");
  await assert.rejects(client.finish(f.bridge, "demo", [one, { ...two, artifact: path.join(f.root, "missing") }], "p1"));
  await assert.rejects(fs.stat(path.join(f.bridge, "requests")), { code: "ENOENT" });
  f.running([{ Name: "game.exe", ExecutablePath: null }]);
  const job = await client.finish(f.bridge, "demo", [one, two], "p1");
  await f.engine.tick();
  const second = await readJson(path.join(f.bridge, "builds", job.builds[1].buildId + ".json"));
  await fs.writeFile(path.join(f.staging, second.stagedId, "two.bin"), "tampered");
  f.running([]); await f.engine.tick();
  const result = await receipt(f.bridge, job.id);
  assert.equal(result.status, "failed"); assert.match(result.error, /different bytes/);
  assert.equal(f.profile.modState["old-one"].enabled, true); assert.equal(f.deployments(), 0);
});

test("a config change invalidates a durable request, and a fully superseded request cannot revive", async t => {
  const f = await fixture(t);
  const first = await client.finish(f.bridge, "demo", [await f.selection()], "p1");
  const second = await client.finish(f.bridge, "demo", [await f.selection("one", "1.0.2")], "p1");
  await cancel(f.bridge, second.id); await f.engine.tick();
  assert.equal((await receipt(f.bridge, first.id)).status, "superseded");
  assert.equal(f.deployments(), 0);
  const next = await client.finish(f.bridge, "demo", [await f.selection("one", "1.0.3")], "p1");
  const registeredPath = path.join(f.bridge, "projects", "demo.json");
  const config = await readJson(registeredPath); config.config.packages[0].displayName = "New name";
  await atomicJson(registeredPath, config); await f.engine.tick();
  assert.equal((await receipt(f.bridge, next.id)).status, "failed");
  assert.equal(f.deployments(), 0);
});

test("Vortex running tools block finalization and process paths use directory containment", async t => {
  const { gameProcess } = require("../src/extension/processes");
  assert.equal(gameProcess([{ Name: "game.exe", ExecutablePath: "C:\\Games\\FoA backup\\game.exe" }], "C:\\Games\\FoA", "game.exe"), false);
  assert.equal(gameProcess([{ Name: "game.exe", ExecutablePath: null }], "C:\\Games\\FoA", "game.exe"), true);
  assert.equal(gameProcess([{ Name: "child.exe", ExecutablePath: "c:\\games\\foa\\bin\\child.exe" }], "C:\\Games\\FoA", "game.exe"), true);
  const f = await fixture(t);
  f.state.session.base.toolsRunning = { game: { pid: 1 } };
  const job = await client.finish(f.bridge, "demo", [await f.selection()], "p1");
  await f.engine.tick(); assert.equal((await receipt(f.bridge, job.id)).status, "pending");
  assert.equal(f.deployments(), 0);
});
