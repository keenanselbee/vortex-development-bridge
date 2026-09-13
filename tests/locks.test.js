"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const { lock, readJson } = require("../src/protocol/files");
const { ownerState } = require("../src/protocol/locks");

async function fixture(t) {
  const parent = path.resolve(".codex-temp/tests");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "locks-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function child(t, root, mode) {
  const worker = fork(path.join(__dirname, "fixtures/lock-child.js"), [root, mode], { silent: true, windowsHide: true });
  const exited = once(worker, "exit");
  let stderr = "";
  worker.stderr.on("data", data => { stderr += data; });
  t.after(async () => { if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL"); await exited; });
  return { worker, exited, stderr: () => stderr };
}

test("active owners wait briefly, serialize actions, and release after errors", async t => {
  const root = await fixture(t);
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let finish;
  const first = lock(root, async () => { entered(); await new Promise(resolve => { finish = resolve; }); });
  await ready;
  await assert.rejects(lock(root, () => assert.fail("live lock entered"), { waitMs: 0 }), { code: "VDB_LOCK_BUSY" });
  const second = lock(root, async () => "after first");
  finish();
  await first;
  assert.equal(await second, "after first");
  await assert.rejects(lock(root, () => { throw new Error("action failed"); }), /action failed/);
  await lock(root, () => {});
  assert.deepEqual(await fs.readdir(root), []);
});

test("a killed owner is recovered once and competing processes remain exclusive", async t => {
  const root = await fixture(t);
  const stopped = child(t, root, "hold");
  await once(stopped.worker, "message");
  stopped.worker.kill("SIGKILL");
  await stopped.exited;
  assert.equal(ownerState(stopped.worker.pid), "dead");
  const workers = Array.from({ length: 6 }, () => child(t, root, "race"));
  for (const worker of workers) assert.equal((await worker.exited)[0], 0, worker.stderr());
  const entries = await fs.readdir(root);
  assert.equal(entries.filter(name => name.startsWith("operation.lock.recovered-")).length, 1);
  assert.ok(!entries.includes("operation.lock") && !entries.includes("operation.lock.recovery") && !entries.includes("active"));
});

test("normal explicit process exit releases its owned lock", async t => {
  const root = await fixture(t);
  const worker = child(t, root, "exit");
  assert.equal((await worker.exited)[0], 0, worker.stderr());
  assert.deepEqual(await fs.readdir(root), []);
});

test("legacy dead owners recover, but old live and ambiguous owners are retained", async t => {
  const root = await fixture(t);
  const worker = child(t, root, "exit");
  await worker.exited;
  const location = path.join(root, "operation.lock");
  await fs.mkdir(location);
  await fs.writeFile(path.join(location, "owner.json"), JSON.stringify({ pid: worker.worker.pid, startedAt: "2000-01-01T00:00:00Z" }));
  await lock(root, () => {});
  await fs.mkdir(location);
  const owner = { pid: process.pid, startedAt: "2000-01-01T00:00:00Z", token: "prior-owner" };
  await fs.writeFile(path.join(location, "owner.json"), JSON.stringify(owner));
  await assert.rejects(lock(root, () => assert.fail("live/reused PID entered"), { waitMs: 0 }), { code: "VDB_LOCK_BUSY" });
  assert.deepEqual(await readJson(path.join(location, "owner.json")), owner);
  await fs.writeFile(path.join(location, "owner.json"), "incomplete");
  await assert.rejects(lock(root, () => assert.fail("unknown owner entered"), { waitMs: 0 }), { code: "VDB_LOCK_UNVERIFIED" });
  assert.equal(await fs.readFile(path.join(location, "owner.json"), "utf8"), "incomplete");
  await fs.unlink(path.join(location, "owner.json"));
  await assert.rejects(lock(root, () => assert.fail("missing owner entered"), { waitMs: 0 }), { code: "VDB_LOCK_UNVERIFIED" });
});

test("process inspection failures never establish a dead owner", () => {
  const kill = process.kill;
  try {
    for (const code of ["EPERM", "EACCES", "EINVAL"]) {
      process.kill = () => { throw Object.assign(new Error("unavailable"), { code }); };
      assert.equal(ownerState(123), "unknown");
    }
  } finally { process.kill = kill; }
});

test("an interrupted recovery guard is retained for inspection", async t => {
  const root = await fixture(t);
  const worker = child(t, root, "exit");
  await worker.exited;
  const owner = { pid: worker.worker.pid, startedAt: "2000-01-01T00:00:00Z" };
  for (const name of ["operation.lock", "operation.lock.recovery"]) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, "owner.json"), JSON.stringify(owner));
  }
  await assert.rejects(lock(root, () => assert.fail("uncertain recovery entered"), { waitMs: 0 }), { code: "VDB_LOCK_UNVERIFIED" });
  assert.deepEqual(await fs.readdir(root), ["operation.lock", "operation.lock.recovery"]);
});
