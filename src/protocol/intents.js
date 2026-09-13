"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const { atomicJson, readJson, fingerprint, lock } = require("./files");

const CAPABILITY = "profile-finish-v3";

function intentKey(request, packageId) {
  return JSON.stringify([request.projectId, request.payload.stageOnly ? "stage-only" : request.payload.profileScope === "all" ? "*" : request.payload.profileId, packageId]);
}

async function latest(root) {
  try { return await readJson(path.join(root, "intents", "latest.json")); }
  catch (error) { if (error.code === "ENOENT") return { generation: 0, packages: {} }; throw error; }
}

async function enqueueFinish(root, registration, builds, profileId, stageOnly) {
  const { validateRequest } = require("./queue");
  return lock(path.join(root, "submit"), async () => {
    const index = await latest(root);
    const request = validateRequest({ protocolVersion: 3, id: crypto.randomUUID(), operation: "finish",
      projectId: registration.config.id, packageId: builds[0].packageId,
      configHash: fingerprint(registration.config), createdAt: new Date().toISOString(),
      generation: index.generation + 1, payload: { builds, profileId: stageOnly ? null : profileId || null, stageOnly,
        profileScope: stageOnly ? "stage-only" : profileId ? "profile" : "all" } });
    index.generation = request.generation;
    index.generations ||= {};
    for (const build of builds) {
      const key = intentKey(request, build.packageId);
      index.packages[key] = request.id;
      index.generations[key] = request.generation;
    }
    // Publish intent identity first: a crash cannot make an older update current again.
    await atomicJson(path.join(root, "intents", "latest.json"), index);
    await atomicJson(path.join(root, "requests", request.id + ".json"), request);
    return request;
  });
}

async function currentBuilds(root, request, profileId) {
  const index = await latest(root);
  return request.payload.builds.filter(build => {
    if (index.packages[intentKey(request, build.packageId)] !== request.id) return false;
    if (request.payload.stageOnly) return true;
    const otherScope = request.payload.profileScope === "all" ? profileId : "*";
    if (!otherScope) return true;
    return (index.generations?.[JSON.stringify([request.projectId, otherScope, build.packageId])] || 0) <= request.generation;
  });
}

async function cancel(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id || "")) throw new Error("Invalid request ID");
  return lock(path.join(root, "consumer"), async () => {
    const request = await readJson(path.join(root, "requests", id + ".json"));
    if (![2, 3].includes(request.protocolVersion) || request.operation !== "finish") throw new Error("Only a pending finish can be cancelled");
    const { receipt } = require("./queue");
    const previous = await receipt(root, id);
    if (previous.status !== "pending" || previous.deploymentStarted) throw new Error("Operation has started or finished; inspect its receipt before recovery");
    const result = { ...previous, id, requestHash: fingerprint(request), projectId: request.projectId,
      packageId: request.packageId, operation: "finish", status: "cancelled", completedAt: new Date().toISOString() };
    await atomicJson(path.join(root, "receipts", id + ".json"), result);
    return result;
  });
}

module.exports = { CAPABILITY, enqueueFinish, currentBuilds, cancel };
