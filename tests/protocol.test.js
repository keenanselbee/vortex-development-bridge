"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { inside, inventory, differences, fingerprint } = require("../src/protocol/files");
const { validateProject } = require("../src/protocol/config");
const { makeRequest, enqueue, validateRequest, receipt } = require("../src/protocol/queue");

const config = { schemaVersion: 1, id: "demo", gameId: "eldenring", packages: [
  { id: "main", displayName: "Demo", installation: "prepared-directory" },
] };
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
});
test("inventory detects changes and excludes no hidden payloads", async t => {
  const root = await scratch(t);
  await fs.writeFile(path.join(root, ".hidden"), "before");
  const before = await inventory(root);
  await fs.writeFile(path.join(root, ".hidden"), "after");
  assert.deepEqual(differences(before, await inventory(root)), [{ path: ".hidden", state: "changed" }]);
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
