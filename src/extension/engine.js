"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { readJson, atomicJson, inventory, differences, fingerprint, inside, hash, lock } = require("../protocol/files");
const { validateProject, VERSION } = require("../protocol/config");
const { validateRequest } = require("../protocol/queue");
const { inspectZip } = require("../protocol/archive");

function buildKey(value) {
  if (!/^[a-f0-9]{24}$/.test(value || "")) throw new Error("Invalid build ID");
  return value;
}
async function listJson(root) {
  try { return (await fs.readdir(root)).filter(name => /^[a-z0-9._-]+\.json$/.test(name)).sort(); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

class Engine {
  constructor(root, adapter) { this.root = root; this.adapter = adapter; this.busy = false; }

  async resolve(request) {
    validateRequest(request);
    const registration = await readJson(path.join(this.root, "projects", request.projectId + ".json"));
    const config = validateProject(registration.config);
    if (config.id !== request.projectId || fingerprint(config) !== request.configHash) throw new Error("Project configuration changed; register and submit a fresh request");
    const pkg = config.packages.find(p => p.id === request.packageId);
    if (!pkg) throw new Error("Package is not registered");
    return { config, pkg };
  }

  async loadBuild(request, config, pkg) {
    const build = await readJson(path.join(this.root, "builds", buildKey(request.payload.buildId) + ".json"));
    if (build.projectId !== config.id || build.packageId !== pkg.id || build.gameId !== config.gameId || build.configHash !== request.configHash) throw new Error("Build belongs to another project, package or configuration");
    const context = this.adapter.context(config.gameId, request.payload.profileId);
    const staged = context.mods[build.stagedId];
    if (!staged || staged.attributes?.vdbBuildId !== build.id || staged.installationPath !== build.stagedId || (staged.type || "") !== (pkg.modType || "")) throw new Error("Vortex staged identity has changed or is missing");
    const stagePath = inside(context.stagingRoot, build.stagedId);
    const changes = differences(build.files, await inventory(stagePath));
    if (changes.length) throw new Error(`Staged payload drift: ${JSON.stringify(changes.slice(0, 10))}`);
    return { build, context, stagePath };
  }

  async stage(request, config, pkg, progress) {
    const payload = request.payload;
    buildKey(payload.buildId);
    if (!VERSION.test(payload.version || "") || !Array.isArray(payload.files) || !payload.files.length) throw new Error("Invalid build manifest");
    const actual = await inventory(path.join(this.root, "artifacts", payload.buildId));
    if (differences(payload.files, actual).length || fingerprint(actual) !== payload.contentHash) throw new Error("Prepared artifact changed");
    if (fingerprint({ project: config.id, package: pkg.id, version: payload.version, contentHash: payload.contentHash, configHash: request.configHash }).slice(0, 24) !== payload.buildId) throw new Error("Build identity does not match its contents");
    const context = this.adapter.context(config.gameId, payload.profileId);
    // Resolve the game extension's deployment type before writing staging.
    this.adapter.deploymentRoot(config.gameId, pkg.modType);
    const stagedId = `vdb-${config.id}-${pkg.id}-${payload.buildId}`;
    const destination = inside(context.stagingRoot, stagedId);
    let exists = false;
    try { await fs.stat(destination); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (exists) {
      if (differences(actual, await inventory(destination)).length) throw new Error("Existing stage has different bytes; no files were overwritten");
      if (!context.mods[stagedId]) throw new Error("An unregistered staging folder already exists; review interrupted staging before recovery");
    } else {
      if (context.mods[stagedId]) throw new Error("Vortex records an existing stage but its directory is missing");
      const temporary = inside(context.stagingRoot, `.vdb-${request.id}`);
      await fs.mkdir(temporary);
      await progress({ phase: "copying", temporary, destination });
      for (const file of actual) {
        const target = inside(temporary, file.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(inside(path.join(this.root, "artifacts", payload.buildId), file.path), target, fs.constants.COPYFILE_EXCL);
      }
      if (differences(actual, await inventory(temporary)).length) throw new Error("Copied stage differs from its manifest");
      await fs.rename(temporary, destination);
      await progress({ phase: "registering", destination });
    }
    const attributes = {
      name: pkg.displayName, version: payload.version, logicalFileName: `vdb:${config.id}:${pkg.id}`,
      source: "other", vdbProjectId: config.id, vdbPackageId: pkg.id, vdbBuildId: payload.buildId,
      vdbPublication: "local", installTime: new Date().toISOString(),
    };
    if (!context.mods[stagedId]) await this.adapter.register(config.gameId, {
      id: stagedId, type: pkg.modType || "", installationPath: stagedId, state: "installed", attributes,
    });
    else if (context.mods[stagedId].attributes?.vdbBuildId !== payload.buildId) throw new Error("Existing Vortex stage is not owned by this build");
    const build = { id: payload.buildId, projectId: config.id, packageId: pkg.id, gameId: config.gameId,
      configHash: request.configHash, stagedId, version: payload.version, files: actual, createdAt: new Date().toISOString() };
    const recordPath = path.join(this.root, "builds", build.id + ".json");
    try {
      const previous = await readJson(recordPath);
      if (previous.configHash !== build.configHash || differences(previous.files, build.files).length) throw new Error("Build record differs");
    } catch (error) { if (error.code === "ENOENT") await atomicJson(recordPath, build); else throw error; }
    if (pkg.activation === "replace-enabled-version") {
      if (!payload.profileId) throw new Error("Automatic activation needs an explicit profile");
      const refreshed = this.adapter.context(config.gameId, payload.profileId);
      const enabled = Object.entries(refreshed.mods).some(([id, mod]) => mod.attributes?.vdbProjectId === config.id
        && mod.attributes?.vdbPackageId === pkg.id && refreshed.profile.modState?.[id]?.enabled);
      if (enabled) return { buildId: build.id, stagedId, ...(await this.deploy(request, config, pkg, progress)) };
      return { buildId: build.id, stagedId, activation: "unchanged", reason: "No managed version is enabled in this profile" };
    }
    return { buildId: build.id, stagedId, activation: "unchanged" };
  }

  async deploy(request, config, pkg, progress) {
    if (!request.payload.profileId) throw new Error("Deployment requires an explicit profile ID");
    const { build, context } = await this.loadBuild(request, config, pkg);
    const siblings = Object.entries(context.mods).filter(([id, mod]) => id !== build.stagedId
      && mod.attributes?.vdbProjectId === config.id && mod.attributes?.vdbPackageId === pkg.id
      && context.profile.modState?.[id]?.enabled).map(([id]) => id);
    await progress({ phase: "activating", profileId: context.profile.id, previousEnabled: siblings,
      targetPreviouslyEnabled: !!context.profile.modState?.[build.stagedId]?.enabled, target: build.stagedId });
    await this.adapter.activate(config.gameId, request.payload.profileId, build.stagedId, siblings);
    await progress({ phase: "deploying" });
    await this.adapter.deploy(config.gameId, request.payload.profileId);
    const verification = await this.verify(request, config, pkg);
    return { buildId: build.id, activation: "completed", deployment: "completed", verification };
  }

  async verify(request, config, pkg) {
    const { build, context } = await this.loadBuild(request, config, pkg);
    if (!request.payload.profileId) return { staged: "verified", deployed: "not-checked", fileCount: build.files.length };
    const deploymentRoot = this.adapter.deploymentRoot(config.gameId, pkg.modType);
    const results = [];
    for (const file of build.files) {
      let state;
      try { state = await hash(inside(deploymentRoot, file.path)) === file.sha256 ? "match" : "different"; }
      catch (error) { if (error.code === "ENOENT") state = "missing"; else throw error; }
      if (state !== "match") results.push({ path: file.path, state });
    }
    return { staged: "verified", enabled: !!context.profile.modState?.[build.stagedId]?.enabled,
      deployed: results.length ? "differences" : "verified", differences: results,
      note: "Different live bytes may be another mod's override; this check does not infer the winner or prove gameplay." };
  }

  async promote(request, config, pkg, progress) {
    const { build } = await this.loadBuild(request, config, pkg);
    const r = request.payload.release;
    if (!r || !/^[a-f0-9]{64}$/.test(r.sha256 || "") || !/^[a-f0-9]{32}$/.test(r.md5 || "")) throw new Error("Invalid release fingerprints");
    if (!pkg.nexus || String(pkg.nexus.gameScopedModId) !== String(r.gameScopedModId)
        || String(pkg.nexus.groupId) !== String(r.groupId) || pkg.nexus.gameDomain !== r.gameDomain) throw new Error("Release does not match the configured package's Nexus identity");
    for (const id of [r.gameScopedModId, r.gameScopedFileId]) if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error("Invalid game-scoped Nexus ID");
    if (r.version !== build.version) throw new Error("Published and staged versions differ");
    const archive = path.join(this.root, "releases", r.sha256, "release.zip");
    if ((await fs.stat(archive)).size !== r.size || await hash(archive) !== r.sha256 || await hash(archive, "md5") !== r.md5) throw new Error("Release archive fingerprints differ");
    if (differences(build.files, await inspectZip(archive)).length) throw new Error("Published archive does not match the staged payload layout");
    await progress({ phase: "promoting-metadata" });
    return this.adapter.promote(config.gameId, build.stagedId, r, archive);
  }

  async process(file) {
    const request = await readJson(file);
    const expectedName = request.id + ".json";
    if (path.basename(file) !== expectedName || !/^[a-f0-9-]{36}\.json$/.test(expectedName)) throw new Error("Request filename does not match its ID");
    const resultPath = path.join(this.root, "receipts", expectedName);
    const requestHash = fingerprint(request);
    let previous;
    try { previous = await readJson(resultPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previous) {
      if (previous.requestHash !== requestHash) throw new Error("Receipt identity collision");
      if (previous.status === "running") await atomicJson(resultPath, { ...previous, status: "interrupted", error: "The prior consumer stopped. Inspect the recorded phase and Vortex state before submitting a recovery request." });
      return;
    }
    let journal = { id: request.id, requestHash, projectId: request.projectId, packageId: request.packageId, operation: request.operation, status: "running", startedAt: new Date().toISOString(), history: [] };
    const progress = async step => {
      journal = { ...journal, ...step, history: [...journal.history, { ...step, at: new Date().toISOString() }] };
      await atomicJson(resultPath, journal);
    };
    try {
      const { config, pkg } = await this.resolve(request);
      await progress({ phase: "validated" });
      let result;
      if (request.operation === "stage") result = await this.stage(request, config, pkg, progress);
      else if (request.operation === "deploy") result = await this.deploy(request, config, pkg, progress);
      else if (request.operation === "verify") result = await this.verify(request, config, pkg);
      else if (request.operation === "promote" && this.promote) result = await this.promote(request, config, pkg, progress);
      else throw new Error("Operation is not available in this build");
      await atomicJson(resultPath, { ...journal, status: "completed", completedAt: new Date().toISOString(), result });
    } catch (error) {
      await atomicJson(resultPath, { ...journal, status: Date.parse(request.expiresAt) <= Date.now() ? "expired" : "failed", error: error.message, completedAt: new Date().toISOString() });
    }
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await lock(path.join(this.root, "consumer"), async () => {
      for (const file of await listJson(path.join(this.root, "requests"))) {
        try { await this.process(path.join(this.root, "requests", file)); }
        catch (error) { await atomicJson(path.join(this.root, "invalid", file), { error: error.message }); }
      }
      const receipts = [];
      for (const file of (await listJson(path.join(this.root, "receipts"))).slice(-100)) receipts.push(await readJson(path.join(this.root, "receipts", file)));
      await atomicJson(path.join(this.root, "status.json"), {
        protocolVersion: 1, extensionVersion: require("../../package.json").version,
        capabilities: ["stage", "deploy", "verify", "rollback", "promote"], observedAt: new Date().toISOString(),
        ...this.adapter.snapshot(), receipts,
      });
      });
    } finally { this.busy = false; }
  }
}

module.exports = { Engine, buildKey, listJson };
