"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { inside, readJson, atomicJson, inventory, differences, fingerprint } = require("../src/protocol/files");
const { validateProject } = require("../src/protocol/config");
const { makeRequest, enqueue, validateRequest, receipt } = require("../src/protocol/queue");

const config = { schemaVersion: 1, id: "demo", gameId: "eldenring", packages: [
  { id: "main", displayName: "Demo", installation: "prepared-directory" },
] };
test("CLI exit codes distinguish deployment differences from completed verification", () => {
  const { outcomeCode } = require("../src/client/cli");
  assert.equal(outcomeCode({ status: "completed", result: { deployed: "differences" } }), 3);
  assert.equal(outcomeCode({ status: "completed", result: { verification: [{ deployed: "verified" }, { deployed: "differences" }] } }), 3);
  assert.equal(outcomeCode({ status: "completed", result: { deployed: "verified", enabled: true } }), 0);
  assert.equal(outcomeCode({ status: "pending" }), 2);
});
test("CLI accepts an exact project/package reconcile request", () => {
  const { parse } = require("../src/client/cli");
  assert.deepEqual(parse(["reconcile", "--project", "demo", "--package", "main"]),
    { command: "reconcile", project: "demo", package: "main" });
});
test("CLI rejects retired migration commands without creating queue data", async t => {
  const { main } = require("../src/client/cli");
  const root = await scratch(t);
  for (const command of ["legacy-publication-dry-run", "legacy-publication-apply"]) {
    await assert.rejects(main([command, "--bridge", root]), /Unknown command/);
  }
  assert.deepEqual(await fs.readdir(root), []);
  assert.doesNotMatch(await main(["help"]), /legacy-publication|--migration|--staged-id/);
});
async function scratch(t) {
  const root = path.resolve(".codex-temp/tests");
  await fs.mkdir(root, { recursive: true });
  const folder = await fs.mkdtemp(path.join(root, "protocol-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}
test("paths cannot escape or use Windows streams", () => {
  for (const p of ["../a", "/x", "a/../b", "a:b", "a\\b", "a//b"]) assert.throws(() => inside("root", p));
});
test("duplicate packages and unsupported installation modes are rejected", () => {
  assert.equal(validateProject(config), config);
  assert.throws(() => validateProject({ ...config, packages: [...config.packages, ...config.packages] }));
  assert.throws(() => validateProject({ ...config, packages: [{ ...config.packages[0], installation: "guess" }] }));
  assert.throws(() => validateProject({ ...config, packages: [{ ...config.packages[0], nexus: { gameDomain: "demo", gameScopedModId: "0", groupId: "2" } }] }));
  assert.throws(() => validateProject({ ...config, packages: [{ ...config.packages[0], logicalFileName: "   " }] }), /logicalFileName/);
});
test("inventory detects changes and excludes no hidden payloads", async t => {
  const root = await scratch(t);
  await fs.writeFile(path.join(root, ".hidden"), "before");
  const before = await inventory(root);
  await fs.writeFile(path.join(root, ".hidden"), "after");
  assert.deepEqual(differences(before, await inventory(root)), [{ path: ".hidden", state: "changed" }]);
});
test("atomic JSON replacement retries transient Windows rename contention", async t => {
  const root = await scratch(t);
  const file = path.join(root, "receipt.json");
  await atomicJson(file, { state: "before" });
  const rename = fs.rename;
  let attempts = 0;
  fs.rename = async (...args) => {
    attempts++;
    if (attempts < 3) {
      const error = new Error("simulated Windows file contention");
      error.code = "EPERM";
      throw error;
    }
    return rename(...args);
  };
  try {
    await atomicJson(file, { state: "after" });
  } finally {
    fs.rename = rename;
  }
  assert.equal(attempts, 3);
  assert.deepEqual(await readJson(file), { state: "after" });
});
test("requests expire and repeated IDs cannot change meaning", async t => {
  const root = await scratch(t);
  const request = makeRequest({ config }, "main", "verify", {});
  assert.equal(request.configHash, fingerprint(config));
  await enqueue(root, request);
  await enqueue(root, request);
  await assert.rejects(enqueue(root, { ...request, payload: { changed: true } }), /different contents/);
  assert.throws(() => validateRequest(request, Date.parse(request.expiresAt) + 1), /expired/);
  assert.equal((await receipt(root, request.id)).status, "pending");
});
