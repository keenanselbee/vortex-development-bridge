"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { project, VERSION } = require("../protocol/config");
const { atomicJson, readJson, inventory, fingerprint, differences, inside, lock } = require("../protocol/files");
const { enqueue, makeRequest } = require("../protocol/queue");
const { receipt: migrationReceipt, trust: trustMigration } = require("../protocol/migration");

async function register(root, file) {
  const registration = await project(file);
  await atomicJson(path.join(root, "projects", registration.config.id + ".json"), registration);
  return { project: registration.config.id, packages: registration.config.packages.map(p => p.id), configHash: fingerprint(registration.config) };
}

async function registered(root, id) {
  const { identifier } = require("../protocol/config");
  identifier(id, "project ID");
  return readJson(path.join(root, "projects", id + ".json"));
}

async function stage(root, id, packageId, artifact, version, profileId) {
  if (!VERSION.test(version || "")) throw new Error("Pass a semantic --version, for example 0.1.0");
  const registration = await registered(root, id);
  const pkg = registration.config.packages.find(p => p.id === packageId);
  if (!pkg) throw new Error("Package is not registered");
  if ((pkg.activation || "stage-only") === "replace-enabled-version" && !profileId) throw new Error("Automatic activation requires an explicit --profile");
  const source = path.resolve(artifact);
  const files = await inventory(source);
  if (!files.length) throw new Error("Artifact is empty");
  const contentHash = fingerprint(files);
  const buildId = fingerprint({ project: id, package: packageId, version, contentHash, configHash: fingerprint(registration.config) }).slice(0, 24);
  const artifactRoot = path.join(root, "artifacts", buildId);
  await lock(path.join(root, "prepare"), async () => {
    let exists = false;
    try { await fs.stat(artifactRoot); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!exists) {
      const temporary = artifactRoot + ".preparing";
      await fs.mkdir(temporary, { recursive: true });
      if ((await fs.readdir(temporary)).length) throw new Error(`Interrupted preparation: ${temporary}; review before retrying`);
      for (const file of files) {
        const target = inside(temporary, file.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(inside(source, file.path), target, fs.constants.COPYFILE_EXCL);
      }
      if (differences(files, await inventory(temporary)).length || differences(files, await inventory(source)).length) throw new Error("Artifact changed while preparing");
      await fs.rename(temporary, artifactRoot);
    }
    if (differences(files, await inventory(artifactRoot)).length) throw new Error("Existing prepared artifact differs");
  });
  const request = makeRequest(registration, packageId, "stage", { buildId, version, files, contentHash, profileId: profileId || null });
  await enqueue(root, request);
  return { id: request.id, buildId, status: "queued", files: files.length };
}

async function submit(root, id, packageId, operation, payload) {
  const registration = await registered(root, id);
  if (!registration.config.packages.some(p => p.id === packageId)) throw new Error("Package is not registered");
  const request = makeRequest(registration, packageId, operation, payload);
  await enqueue(root, request);
  return { id: request.id, status: "queued" };
}

async function status(root) {
  try {
    const state = await readJson(path.join(root, "status.json"));
    return { ...state, stale: Date.now() - Date.parse(state.observedAt) > 20000 };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "unavailable", reason: "Vortex has not written a status snapshot. Install/enable the extension and open Vortex." };
    throw error;
  }
}

async function promote(root, id, packageId, buildId, receiptPath) {
  const document = await readJson(path.resolve(receiptPath));
  const release = document.receipt || document;
  if (!/^[a-f0-9]{64}$/.test(release.sha256 || "") || !release.archive) throw new Error("Invalid release receipt");
  await storeRelease(root, release.archive, release);
  return submit(root, id, packageId, "promote", { buildId, release: { ...release, archive: undefined } });
}

async function storeRelease(root, sourcePath, release) {
  const { hash, releaseArchiveName } = require("../protocol/files");
  const source = path.resolve(sourcePath);
  if ((await fs.stat(source)).size !== Number(release.size) || await hash(source) !== release.sha256 || await hash(source, "md5") !== release.md5) {
    throw new Error("Release archive differs from its receipt");
  }
  const directory = path.join(root, "releases", release.sha256);
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, releaseArchiveName(release.sha256));
  try { await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  if ((await fs.stat(destination)).size !== Number(release.size) || await hash(destination) !== release.sha256 || await hash(destination, "md5") !== release.md5) {
    throw new Error("Queued release archive differs");
  }
  return destination;
}

async function legacyPublicationMigration(root, id, packageId, stagedId, migrationPath, apply) {
  const registration = await registered(root, id);
  const pkg = registration.config.packages.find(item => item.id === packageId);
  if (!pkg) throw new Error("Package is not registered");
  const source = await readJson(path.resolve(migrationPath));
  const migration = migrationReceipt(source);
  if (migration.projectId !== id || migration.packageId !== packageId || migration.stagedId !== stagedId) {
    throw new Error("Migration receipt does not match the requested project, package and staged ID");
  }
  if (migration.gameId !== registration.config.gameId || !pkg.nexus
      || migration.nexus.gameDomain !== pkg.nexus.gameDomain
      || migration.nexus.gameScopedModId !== String(pkg.nexus.gameScopedModId)
      || migration.nexus.groupId !== String(pkg.nexus.groupId)) {
    throw new Error("Migration receipt does not match the registered package Nexus identity");
  }
  await storeRelease(root, migration.archive.path, migration.archive);
  const trusted = await trustMigration(root, source);
  return submit(root, id, packageId, apply ? "legacy-publication-apply" : "legacy-publication-dry-run", {
    stagedId, migrationReceiptId: trusted.id, migrationSignature: trusted.signature,
  });
}

function reconcile(root, id, packageId) {
  return submit(root, id, packageId, "reconcile", {});
}

module.exports = { register, registered, stage, submit, status, promote, reconcile, legacyPublicationMigration };
