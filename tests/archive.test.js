"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createZip, inspectZip } = require("../src/protocol/archive");
const { readJson } = require("../src/protocol/files");

test("archive preserves nested paths and rejects duplicate release outputs", async t => {
  const parent = path.resolve(".codex-temp/tests");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "zip-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "source/mod"), { recursive: true });
  await fs.mkdir(path.join(root, "source/mods"));
  await fs.writeFile(path.join(root, "source/mod/regulation.bin"), "mod data");
  await fs.writeFile(path.join(root, "source/mods/loader.dll"), "loader");
  const zip = path.join(root, "package.zip");
  const files = await createZip(path.join(root, "source"), zip);
  assert.deepEqual(await inspectZip(zip), files);
  await assert.rejects(createZip(path.join(root, "source"), zip));
});

test("built extension has root metadata and a working standalone client", async () => {
  let latest;
  try { latest = await readJson(path.resolve("dist/latest.json")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const entries = await inspectZip(latest.archive);
  assert.ok(entries.some(x => x.path === "index.js"));
  assert.ok(entries.some(x => x.path === "info.json"));
  assert.ok(!entries.some(x => x.path.includes("node_modules/") || x.path.includes(".local.")));
  const info = await readJson(path.join(latest.run, "extension/info.json"));
  assert.equal(info.version, require("../package.json").version);
  const help = execFileSync(process.execPath, [path.join(latest.run, "extension/client/vdb.cjs"), "help"], { encoding: "utf8" });
  assert.match(help, /Vortex Development Bridge/);
  assert.match(help, /finish-batch/);
  assert.match(help, /--stage-only/);
});

test("bundled client prepares durable stage-only work offline without needing a profile", async t => {
  let latest;
  try { latest = await readJson(path.resolve("dist/latest.json")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const parent = path.resolve(".codex-temp/tests");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "bundled-finish-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const clientPath = path.join(latest.run, "extension/client/vdb.cjs");
  const bridge = path.join(root, "bridge"), artifact = path.join(root, "artifact"), config = path.join(root, "vdb.json");
  await fs.mkdir(artifact); await fs.writeFile(path.join(artifact, "demo.bin"), "final");
  await fs.writeFile(config, JSON.stringify({ schemaVersion: 1, id: "demo", gameId: "demo",
    packages: [{ id: "main", displayName: "Main", installation: "prepared-directory", activation: "replace-enabled-version" }] }));
  const invoke = args => JSON.parse(execFileSync(process.execPath, [clientPath, ...args, "--bridge", bridge, "--json"], { encoding: "utf8" }));
  invoke(["register", "--config", config]);
  const job = invoke(["finish", "--project", "demo", "--package", "main", "--artifact", artifact, "--version", "1.0.0", "--stage-only"]);
  assert.equal(job.protocolVersion, 3);
  const request = await readJson(path.join(bridge, "requests", job.id + ".json"));
  assert.equal(request.payload.stageOnly, true); assert.equal(request.payload.profileId, null);
  assert.equal(request.expiresAt, undefined);
  assert.equal(invoke(["doctor"]).capabilities.includes("profile-finish-v3"), true);
  assert.equal(invoke(["cancel", "--request", job.id]).status, "cancelled");
});

test("bundled extension loads and registers its page without a local Node dependency tree", async () => {
  const vm = require("node:vm");
  let latest;
  try { latest = await readJson(path.resolve("dist/latest.json")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const module = { exports: {} };
  let onceStarted = false;
  const api = new Proxy({ getVortexPath: () => path.resolve(".codex-temp/fake-vortex") }, {
    get(target, property) {
      assert.equal(onceStarted, true, `context.api.${String(property)} was accessed during extension initialization`);
      return target[property];
    },
  });
  const vortex = { util: {}, MainPage: function MainPage() {} };
  const context = { module, exports: module.exports, process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    require: name => name === "vortex-api" ? vortex : name === "react" ? { Component: class {}, createElement() {} } : require(name) };
  vm.runInNewContext(await fs.readFile(path.join(latest.run, "extension/index.js"), "utf8"), context);
  let registered, started;
  const result = module.exports.default({ api, registerMainPage: (...args) => { registered = args; }, once: callback => { started = callback; } });
  assert.equal(result, true);
  assert.equal(registered[3].id, "vortex-development-bridge");
  assert.equal(typeof started, "function");
  onceStarted = true;
});
