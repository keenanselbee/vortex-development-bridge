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
});

test("bundled extension loads and registers its page without a local Node dependency tree", async () => {
  const vm = require("node:vm");
  let latest;
  try { latest = await readJson(path.resolve("dist/latest.json")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const module = { exports: {} };
  const api = { getVortexPath: () => path.resolve(".codex-temp/fake-vortex") };
  const vortex = { util: {}, MainPage: function MainPage() {} };
  const context = { module, exports: module.exports, process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    require: name => name === "vortex-api" ? vortex : name === "react" ? { Component: class {}, createElement() {} } : require(name) };
  vm.runInNewContext(await fs.readFile(path.join(latest.run, "extension/index.js"), "utf8"), context);
  let registered, started;
  const result = module.exports.default({ api, registerMainPage: (...args) => { registered = args; }, once: callback => { started = callback; } });
  assert.equal(result, true);
  assert.equal(registered[3].id, "vortex-development-bridge");
  assert.equal(typeof started, "function");
});
