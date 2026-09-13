"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomicJson, readJson, fingerprint, lock } = require("./files");
const { identifier } = require("./config");
const OPERATIONS = ["stage", "deploy", "deploy-batch", "verify", "promote", "reconcile"];

function validateRequest(request, now = Date.now()) {
  const durable = [2, 3].includes(request.protocolVersion) && request.operation === "finish";
  if (!durable && (request.protocolVersion !== 1 || !OPERATIONS.includes(request.operation))) throw new Error("Unsupported request protocol or operation");
  if (!/^[a-f0-9-]{36}$/.test(request.id || "")) throw new Error("Invalid request ID");
  identifier(request.projectId, "project ID");
  identifier(request.packageId, "package ID");
  if (!durable) {
    if (!Number.isFinite(Date.parse(request.expiresAt)) || Date.parse(request.expiresAt) <= now) throw new Error("Request expired; submit a new request after reviewing current state");
    if (Date.parse(request.expiresAt) > now + 24 * 60 * 60 * 1000) throw new Error("Request expiry exceeds 24 hours");
  } else {
    if (!Number.isSafeInteger(request.generation) || request.generation < 1 || !Number.isFinite(Date.parse(request.createdAt))) throw new Error("Invalid finish generation");
    const p = request.payload;
    if (!p || typeof p.stageOnly !== "boolean" || !Array.isArray(p.builds) || !p.builds.length || p.builds.length > 100) throw new Error("Finish needs 1-100 prepared builds and an explicit mode");
    if (request.protocolVersion === 2 && !p.stageOnly && (typeof p.profileId !== "string" || !p.profileId.trim())) throw new Error("Finish deployment requires an explicit profile");
    if (request.protocolVersion === 3) {
      if (!["all", "profile", "stage-only"].includes(p.profileScope)
          || p.stageOnly !== (p.profileScope === "stage-only")
          || (p.profileScope === "profile" ? typeof p.profileId !== "string" || !p.profileId.trim() : p.profileId !== null)) throw new Error("Invalid finish profile scope");
    }
    const packages = new Set();
    for (const build of p.builds) {
      identifier(build.packageId, "package ID");
      if (packages.has(build.packageId)) throw new Error("Finish selects multiple builds for one package");
      packages.add(build.packageId);
      if (!/^[a-f0-9]{24}$/.test(build.buildId || "")) throw new Error("Invalid finish build identity");
    }
    if (p.builds[0].packageId !== request.packageId) throw new Error("Finish package identity differs");
  }
  if (!request.configHash || !request.payload) throw new Error("Request lacks configuration identity or payload");
  return request;
}

async function enqueue(root, request) {
  validateRequest(request);
  return lock(path.join(root, "submit"), async () => {
    const file = path.join(root, "requests", request.id + ".json");
    let existing;
    try { existing = await readJson(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing && fingerprint(existing) !== fingerprint(request)) throw new Error("Request ID already has different contents");
    if (!existing) await atomicJson(file, request);
    return request;
  });
}

function makeRequest(registration, packageId, operation, payload, minutes = 30) {
  const now = new Date();
  return validateRequest({
    protocolVersion: 1, id: crypto.randomUUID(), operation,
    projectId: registration.config.id, packageId, configHash: fingerprint(registration.config),
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + minutes * 60000).toISOString(), payload,
  });
}

async function receipt(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id || "")) throw new Error("Invalid request ID");
  try { return await readJson(path.join(root, "receipts", id + ".json")); }
  catch (error) { if (error.code === "ENOENT") return { id, status: "pending" }; throw error; }
}

async function wait(root, id, seconds = 30) {
  const deadline = Date.now() + seconds * 1000;
  do {
    const result = await receipt(root, id);
    if (!["pending", "running"].includes(result.status)) return result;
    if (Date.now() >= deadline) return { ...result, waiting: true };
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (true);
}

module.exports = { OPERATIONS, validateRequest, enqueue, makeRequest, receipt, wait };
