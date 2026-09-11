"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { atomicJson, fingerprint, readJson } = require("./files");

const TYPE = "vdb-legacy-publication-migration";
const TRUST_TYPE = "vdb-local-user-trusted-migration";

function nonempty(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Migration receipt requires ${name}`);
  return value;
}

function positive(value, name) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error(`Migration receipt has invalid ${name}`);
  return String(value);
}

function fingerprintValue(value, algorithm) {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${algorithm === "sha256" ? 64 : 32}}$`).test(value)) {
    throw new Error(`Migration receipt has invalid ${algorithm}`);
  }
  return value;
}

function stagedId(value) {
  if (typeof value !== "string" || !value || value !== path.basename(value) || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    throw new Error("Migration receipt has an unsafe stagedId");
  }
  return value;
}

function archiveFileName(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value !== path.basename(value) || value.includes("/") || value.includes("\\")) {
    throw new Error("Migration receipt has an unsafe archive fileName");
  }
  return value;
}

function receipt(value) {
  if (!value || value.schemaVersion !== 1 || value.type !== TYPE) throw new Error("Unsupported legacy publication migration receipt");
  const expected = value.expected || {};
  const nexus = value.nexus || {};
  const archive = value.archive || {};
  if (expected.source !== "grailwright-local") throw new Error("Migration receipt must require grailwright-local source");
  if (!Number.isSafeInteger(Number(archive.size)) || Number(archive.size) <= 0) throw new Error("Migration receipt has invalid archive size");
  return {
    schemaVersion: 1, type: TYPE,
    projectId: nonempty(value.projectId, "projectId"), packageId: nonempty(value.packageId, "packageId"),
    gameId: nonempty(value.gameId, "gameId"), stagedId: stagedId(value.stagedId),
    expected: {
      source: "grailwright-local", logicalFileName: nonempty(expected.logicalFileName, "expected.logicalFileName"),
      modId: positive(expected.modId, "expected.modId"), version: nonempty(expected.version, "expected.version"),
      allowUnattributed: expected.allowUnattributed === true,
    },
    nexus: {
      gameDomain: nonempty(nexus.gameDomain, "nexus.gameDomain"),
      gameScopedModId: positive(nexus.gameScopedModId, "nexus.gameScopedModId"),
      groupId: positive(nexus.groupId, "nexus.groupId"),
      gameScopedFileId: positive(nexus.gameScopedFileId, "nexus.gameScopedFileId"),
      versionId: nonempty(nexus.versionId, "nexus.versionId"),
      allowUnattributedArchive: nexus.allowUnattributedArchive === true,
    },
    archive: {
      path: nonempty(archive.path, "archive.path"), sha256: fingerprintValue(archive.sha256, "sha256"),
      md5: fingerprintValue(archive.md5, "md5"), size: Number(archive.size), fileName: archiveFileName(archive.fileName),
    },
  };
}

function storedReceipt(value) {
  const parsed = receipt({ ...value, archive: { ...(value.archive || {}), path: value.archive?.path || "stored-release.zip" } });
  return { ...parsed, archive: { ...parsed.archive, path: undefined } };
}

async function trustKey(root) {
  const file = path.join(root, "trust", "local-user.key");
  try {
    const key = (await fs.readFile(file, "utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Local migration trust key is invalid");
    return key;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const key = crypto.randomBytes(32).toString("hex");
    try { await fs.writeFile(file, key + "\n", { flag: "wx" }); return key; }
    catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
      return trustKey(root);
    }
  }
}

function signature(key, documentHash, migration) {
  return crypto.createHmac("sha256", key).update(`${documentHash}\n${JSON.stringify(migration)}`).digest("hex");
}

async function trust(root, source) {
  const migration = storedReceipt(source);
  const documentHash = fingerprint(migration);
  const key = await trustKey(root);
  const signed = { schemaVersion: 1, type: TRUST_TYPE, documentHash, migration,
    signature: signature(key, documentHash, migration), trustedAt: new Date().toISOString() };
  const file = path.join(root, "migration-receipts", documentHash + ".json");
  try {
    const previous = await readJson(file);
    if (previous.type !== TRUST_TYPE || previous.documentHash !== documentHash || previous.signature !== signed.signature
        || fingerprint(previous.migration) !== documentHash) throw new Error("Migration receipt identity collision");
  } catch (error) {
    if (error.code === "ENOENT") await atomicJson(file, signed); else throw error;
  }
  return { id: documentHash, signature: signed.signature, migration };
}

async function trusted(root, id, expectedSignature) {
  if (!/^[a-f0-9]{64}$/.test(id || "")) throw new Error("Invalid migration receipt ID");
  const document = await readJson(path.join(root, "migration-receipts", id + ".json"));
  if (document.schemaVersion !== 1 || document.type !== TRUST_TYPE || document.documentHash !== id) throw new Error("Migration receipt is not locally trusted");
  const migration = storedReceipt(document.migration);
  if (fingerprint(migration) !== id) throw new Error("Migration receipt content changed");
  const actual = signature(await trustKey(root), id, migration);
  if (!/^[a-f0-9]{64}$/.test(document.signature || "") || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(document.signature))) {
    throw new Error("Migration receipt signature is invalid");
  }
  if (expectedSignature && expectedSignature !== document.signature) throw new Error("Migration request signature does not match its trusted receipt");
  return { id, signature: document.signature, migration };
}

module.exports = { TYPE, receipt, trust, trusted };
