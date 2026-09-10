"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { project, VERSION } = require("../protocol/config");
const { atomicJson, readJson, inventory, fingerprint, differences, inside, lock } = require("../protocol/files");
const { enqueue, makeRequest } = require("../protocol/queue");

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

module.exports = { register, registered, stage, submit, status };
