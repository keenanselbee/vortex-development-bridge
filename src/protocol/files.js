"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createReadStream } = require("node:fs");

function inside(root, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\")
      || relative.includes(":") || relative.split("/").some(p => !p || p === "." || p === "..")
      || path.isAbsolute(relative)) throw new Error(`Unsafe relative path: ${relative}`);
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("Path escapes root");
  return target;
}

async function readJson(file) {
  return JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
}

async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  try { await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}

async function hash(file, algorithm = "sha256") {
  const digest = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

async function inventory(root) {
  const result = [];
  const names = new Set();
  async function visit(directory, prefix = "") {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Expected real directory: ${directory}`);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const full = inside(root, relative);
      if (entry.isSymbolicLink()) throw new Error(`Links are not supported: ${relative}`);
      if (entry.isDirectory()) await visit(full, relative + "/");
      else if (entry.isFile()) {
        const key = relative.toLowerCase();
        if (names.has(key)) throw new Error(`Case-colliding file: ${relative}`);
        names.add(key);
        result.push({ path: relative, size: (await fs.stat(full)).size, sha256: await hash(full) });
      } else throw new Error(`Unsupported file type: ${relative}`);
    }
  }
  await visit(path.resolve(root));
  return result.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function differences(expected, actual) {
  const before = new Map(expected.map(x => [x.path, x]));
  const after = new Map(actual.map(x => [x.path, x]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(name => {
    const a = before.get(name), b = after.get(name);
    const state = !a ? "unexpected" : !b ? "missing" : a.sha256 !== b.sha256 || a.size !== b.size ? "changed" : null;
    return state ? [{ path: name, state }] : [];
  });
}

async function lock(root, action) {
  await fs.mkdir(root, { recursive: true });
  const location = path.join(root, "operation.lock");
  try { await fs.mkdir(location); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`Operation locked: ${location}. Check for a running process before recovering a stale lock.`);
    throw error;
  }
  try {
    await atomicJson(path.join(location, "owner.json"), { pid: process.pid, startedAt: new Date().toISOString() });
    return await action();
  } finally {
    await fs.rm(path.join(location, "owner.json"), { force: true });
    await fs.rmdir(location);
  }
}

module.exports = { inside, readJson, atomicJson, hash, inventory, fingerprint, differences, lock };
