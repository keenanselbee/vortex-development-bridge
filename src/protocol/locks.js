"use strict";

const fs = require("node:fs/promises");
const syncFs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const held = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Normal process exit cannot await finally blocks. Forced termination is handled
// by the next contender's dead-owner check, never by an age-based lease.
process.once("exit", () => {
  for (const [location, token] of held) {
    try {
      const file = path.join(location, "owner.json");
      if (JSON.parse(syncFs.readFileSync(file, "utf8")).token !== token) continue;
      syncFs.unlinkSync(file);
      syncFs.rmdirSync(location);
    } catch { /* Leave uncertain state for conservative recovery. */ }
  }
});

function failure(code, location, message) {
  const error = new Error(`${message}: ${location}`);
  error.code = code;
  return error;
}

async function ownerAt(location) {
  try {
    const directory = await fs.lstat(location);
    const file = path.join(location, "owner.json");
    const stat = await fs.lstat(file);
    if (!directory.isDirectory() || directory.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid lock layout");
    const text = await fs.readFile(file, "utf8");
    const owner = JSON.parse(text);
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !Number.isFinite(Date.parse(owner.startedAt))) throw new Error("Invalid lock owner");
    return { ...owner, text };
  } catch (error) {
    throw failure("VDB_LOCK_UNVERIFIED", location, `Cannot verify lock ownership (${error.message}); inspect before recovery`);
  }
}

function ownerState(pid) {
  try { process.kill(pid, 0); return "alive"; }
  catch (error) { return error.code === "ESRCH" ? "dead" : "unknown"; }
}

async function release(location, token) {
  const owner = await ownerAt(location);
  if (owner.token !== token) throw failure("VDB_LOCK_UNVERIFIED", location, "Lock ownership changed; cleanup stopped");
  // No other cooperating process can replace this owner's lock while it lives.
  await fs.unlink(path.join(location, "owner.json"));
  for (let attempt = 0; ; attempt++) {
    try { await fs.rmdir(location); break; }
    catch (error) {
      if (!["EACCES", "EPERM", "EBUSY"].includes(error.code) || attempt >= 9) throw error;
      await pause(50);
    }
  }
  held.delete(location);
}

async function createOwner(location) {
  const token = crypto.randomUUID();
  const owner = { pid: process.pid, startedAt: new Date().toISOString(), token };
  // A partial/missing owner after a crash is deliberately not guessed from age.
  await fs.writeFile(path.join(location, "owner.json"), JSON.stringify(owner) + "\n", { flag: "wx" });
  held.set(location, token);
  return token;
}

async function recover(location, observed) {
  // Serialize the read/check/rename sequence. Without this separate guard, a
  // delayed reaper could rename the replacement lock created by another caller.
  const guard = location + ".recovery";
  try { await fs.mkdir(guard); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const recovering = await ownerAt(guard);
    if (ownerState(recovering.pid) !== "alive") throw failure("VDB_LOCK_UNVERIFIED", guard, "Interrupted lock recovery needs inspection");
    return;
  }
  const token = await createOwner(guard);
  try {
    let current;
    try { current = await ownerAt(location); }
    catch (error) {
      if (!(await fs.stat(location).catch(e => { if (e.code !== "ENOENT") throw e; }))) return true;
      throw error;
    }
    if (current.text !== observed.text || ownerState(current.pid) !== "dead") return;
    // Retain the abandoned directory as evidence; never delete receipts or replay
    // an interrupted deployment. The engine's existing receipt recovery applies.
    await fs.rename(location, location + ".recovered-" + crypto.randomUUID());
    return true;
  } finally { await release(guard, token); }
}

async function lock(root, action, { waitMs = 1000 } = {}) {
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 30000) throw new Error("Invalid lock wait duration");
  await fs.mkdir(root, { recursive: true });
  const location = path.join(path.resolve(root), "operation.lock");
  const deadline = Date.now() + waitMs;
  let lastError;
  for (;;) {
    let acquired = false;
    try { await fs.mkdir(location); acquired = true; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    if (acquired) {
      const token = await createOwner(location);
      try { return await action(); }
      finally { await release(location, token); }
    }
    try {
      const owner = await ownerAt(location);
      const state = ownerState(owner.pid);
      if (state === "dead") { if (await recover(location, owner)) continue; }
      else if (state === "alive") lastError = failure("VDB_LOCK_BUSY", location, `Another operation is running (PID ${owner.pid})`);
      else lastError = failure("VDB_LOCK_UNVERIFIED", location, `Cannot verify PID ${owner.pid}; inspect before recovery`);
    } catch (error) { lastError = error; }
    if (Date.now() >= deadline) throw lastError || failure("VDB_LOCK_BUSY", location, "Lock recovery is in progress");
    await pause(Math.min(50, Math.max(1, deadline - Date.now())));
  }
}

module.exports = { lock, ownerState };
