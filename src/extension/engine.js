"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { readJson, atomicJson, inventory, differences, fingerprint, inside, hash, releaseArchiveName, lock } = require("../protocol/files");
const { logicalFileName, validateProject, VERSION } = require("../protocol/config");
const { validateRequest } = require("../protocol/queue");
const { inspectZip } = require("../protocol/archive");

function buildKey(value) {
  if (!/^[a-f0-9]{24}$/.test(value || "")) throw new Error("Invalid build ID");
  return value;
}

function describeCollision(id, mod) {
  const attributes = mod.attributes || {};
  return { id, source: attributes.source, modId: attributes.modId,
    vdbProjectId: attributes.vdbProjectId, vdbPackageId: attributes.vdbPackageId };
}

function isOwnedBy(attributes, config, pkg) {
  return attributes?.vdbProjectId === config.id && attributes?.vdbPackageId === pkg.id;
}

function managedSiblings(context, config, pkg, stagedId, includeDisabled = false) {
  const canonical = logicalFileName(pkg);
  const siblings = [];
  const ambiguous = [];
  for (const [id, mod] of Object.entries(context.mods)) {
    if (id === stagedId) continue;
    const attributes = mod.attributes || {};
    if (isOwnedBy(attributes, config, pkg)) {
      if (includeDisabled ? Object.hasOwn(context.profile?.modState || {}, id) : context.profile?.modState?.[id]?.enabled) siblings.push(id);
      continue;
    }
    if (attributes.logicalFileName !== canonical) continue;
    const compatibleLegacy = pkg.nexus && ["nexus", "grailwright-local"].includes(attributes.source)
      && String(attributes.modId) === String(pkg.nexus.gameScopedModId);
    if (compatibleLegacy) {
      if (includeDisabled ? Object.hasOwn(context.profile?.modState || {}, id) : context.profile?.modState?.[id]?.enabled) siblings.push(id);
      continue;
    }
    ambiguous.push(describeCollision(id, mod));
  }
  if (ambiguous.length) throw new Error(`Ambiguous logicalFileName '${canonical}' in game '${config.gameId}': ${JSON.stringify(ambiguous)}`);
  return siblings;
}

function assertStageLogicalNameIsUnambiguous(context, config, pkg) {
  managedSiblings({ ...context, profile: undefined }, config, pkg, undefined);
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
    let build;
    try { build = await readJson(path.join(this.root, "builds", buildKey(request.payload.buildId) + ".json")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const pending = new Error("The staged build is not available yet");
      pending.code = "VDB_BUILD_PENDING";
      throw pending;
    }
    if (build.projectId !== config.id || build.packageId !== pkg.id || build.gameId !== config.gameId) throw new Error("Build belongs to another project, package or game");
    const context = this.adapter.context(config.gameId, request.payload.profileId, request.payload.stageOnly === true);
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
    const stageOnly = payload.stageOnly === true || (pkg.activation || "stage-only") === "stage-only";
    const context = this.adapter.context(config.gameId, payload.profileId, stageOnly);
    assertStageLogicalNameIsUnambiguous(context, config, pkg);
    // Resolve the game extension's deployment type before writing staging.
    this.adapter.deploymentRoot(config.gameId, pkg.modType, stageOnly);
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
      name: pkg.displayName, version: payload.version, logicalFileName: logicalFileName(pkg),
      source: "other", vdbProjectId: config.id, vdbPackageId: pkg.id, vdbBuildId: payload.buildId,
      vdbPublication: "local", vdbConflictInheritance: "pending", installTime: new Date().toISOString(),
    };
    if (pkg.nexus) {
      attributes.modId = Number(pkg.nexus.gameScopedModId);
      attributes.homepage = `https://www.nexusmods.com/${pkg.nexus.gameDomain}/mods/${pkg.nexus.gameScopedModId}`;
      attributes.vdbNexusFileGroupId = pkg.nexus.groupId;
    }
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
    if (!stageOnly && pkg.activation === "replace-enabled-version") {
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
    const siblings = managedSiblings(context, config, pkg, build.stagedId);
    await this.adapter.inheritConflicts(config.gameId, request.payload.profileId, [{ target: build.stagedId, siblings,
      files: build.files, deploymentRoot: this.adapter.deploymentRoot(config.gameId, pkg.modType) }], progress);
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

  async deployBatch(request, config, progress) {
    const { builds, profileId } = request.payload;
    let expectedEnabled = request.payload.expectedEnabled;
    const assertSelection = () => {
      if (!expectedEnabled) return;
      const actual = Object.entries(this.adapter.context(config.gameId, profileId).profile.modState || {})
        .filter(([, value]) => value.enabled).map(([id]) => id).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expectedEnabled)) throw new Error("Profile enabled state changed during finalization; no further activation was attempted");
    };
    if (!profileId || !Array.isArray(builds) || !builds.length || builds.length > 100) throw new Error("Batch needs a profile and 1-100 builds");
    const packages = new Set();
    const prepared = [];
    for (const selection of builds) {
      if (packages.has(selection.packageId)) throw new Error("Batch selects multiple builds for one package");
      packages.add(selection.packageId);
      const pkg = config.packages.find(p => p.id === selection.packageId);
      if (!pkg) throw new Error("Batch includes an unregistered package");
      const subrequest = { ...request, packageId: pkg.id, payload: { buildId: selection.buildId, profileId } };
      const loaded = await this.loadBuild(subrequest, config, pkg);
      const siblings = managedSiblings(loaded.context, config, pkg, loaded.build.stagedId);
      prepared.push({ pkg, subrequest, build: loaded.build, siblings,
        targetPreviouslyEnabled: !!loaded.context.profile.modState?.[loaded.build.stagedId]?.enabled });
    }
    await progress({ phase: "batch-validated", profileId, selections: prepared.map(x => ({ packageId: x.pkg.id, target: x.build.stagedId, previousEnabled: x.siblings, targetPreviouslyEnabled: x.targetPreviouslyEnabled })) });
    if (request.operation === "finish") await this.adapter.assertDeploymentReady(config.gameId, profileId);
    assertSelection();
    await this.adapter.inheritConflicts(config.gameId, profileId, prepared.map(item => ({ target: item.build.stagedId,
      siblings: item.siblings, files: item.build.files, deploymentRoot: this.adapter.deploymentRoot(config.gameId, item.pkg.modType) })), progress);
    for (const item of prepared) {
      if (request.operation === "finish") await this.adapter.assertDeploymentReady(config.gameId, profileId);
      await progress({ phase: "batch-activating", packageId: item.pkg.id });
      assertSelection();
      await this.adapter.activate(config.gameId, profileId, item.build.stagedId, item.siblings);
      if (expectedEnabled) expectedEnabled = [...new Set([...expectedEnabled.filter(id => !item.siblings.includes(id)), item.build.stagedId])].sort();
    }
    await progress({ phase: "deploying" });
    if (request.operation === "finish") await this.adapter.assertDeploymentReady(config.gameId, profileId);
    assertSelection();
    await this.adapter.deploy(config.gameId, profileId);
    const verification = [];
    for (const item of prepared) verification.push({ packageId: item.pkg.id, ...await this.verify(item.subrequest, config, item.pkg) });
    return { deployment: "completed", verification };
  }

  async promote(request, config, pkg, progress) {
    const { build } = await this.loadBuild(request, config, pkg);
    const r = request.payload.release;
    if (!r || !/^[a-f0-9]{64}$/.test(r.sha256 || "") || !/^[a-f0-9]{32}$/.test(r.md5 || "")) throw new Error("Invalid release fingerprints");
    if (!pkg.nexus || String(pkg.nexus.gameScopedModId) !== String(r.gameScopedModId)
        || String(pkg.nexus.groupId) !== String(r.groupId) || pkg.nexus.gameDomain !== r.gameDomain) throw new Error("Release does not match the configured package's Nexus identity");
    for (const id of [r.gameScopedModId, r.gameScopedFileId]) if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error("Invalid game-scoped Nexus ID");
    if (r.version !== build.version) throw new Error("Published and staged versions differ");
    const archive = path.join(this.root, "releases", r.sha256, releaseArchiveName(r.sha256));
    if ((await fs.stat(archive)).size !== r.size || await hash(archive) !== r.sha256 || await hash(archive, "md5") !== r.md5) throw new Error("Release archive fingerprints differ");
    if (differences(build.files, await inspectZip(archive)).length) throw new Error("Published archive does not match the staged payload layout");
    await progress({ phase: "promoting-metadata" });
    return this.adapter.promote(config.gameId, build.stagedId, r, archive, logicalFileName(pkg));
  }

  async reconcile(_request, config, pkg, progress) {
    const context = this.adapter.context(config.gameId);
    assertStageLogicalNameIsUnambiguous(context, config, pkg);
    const canonical = logicalFileName(pkg);
    const candidates = Object.entries(context.mods).filter(([, mod]) => isOwnedBy(mod.attributes, config, pkg))
      .map(([id, mod]) => ({ id, currentLogicalFileName: mod.attributes?.logicalFileName,
        action: mod.attributes?.logicalFileName === canonical ? "unchanged" : "update" }));
    await progress({ phase: "reconcile-preview", logicalFileName: canonical, candidates });
    const updated = [];
    for (const candidate of candidates.filter(candidate => candidate.action === "update")) {
      await this.adapter.attributes(config.gameId, candidate.id, { logicalFileName: canonical });
      updated.push(candidate.id);
    }
    return { logicalFileName: canonical, candidates, updated,
      unchanged: candidates.filter(candidate => candidate.action === "unchanged").map(candidate => candidate.id) };
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
      if (previous.status !== "pending") return;
    }
    let journal = previous
      ? { ...previous, status: "running", error: undefined, retryAfter: undefined }
      : { id: request.id, requestHash, projectId: request.projectId, packageId: request.packageId, operation: request.operation, status: "running", startedAt: new Date().toISOString(), history: [] };
    const progress = async step => {
      journal = { ...journal, ...step, history: [...journal.history, { ...step, at: new Date().toISOString() }].slice(-200) };
      await atomicJson(resultPath, journal);
    };
    try {
      const { config, pkg } = await this.resolve(request);
      await progress({ phase: "validated" });
      let result;
      if (request.operation === "finish") result = request.protocolVersion === 3
        ? await require("./profile-finish").finish(this, request, config, progress, managedSiblings, previous?.result)
        : await require("./finish").finish(this, request, config, progress, managedSiblings);
      else if (request.operation === "stage") result = await this.stage(request, config, pkg, progress);
      else if (request.operation === "deploy") result = await this.deploy(request, config, pkg, progress);
      else if (request.operation === "deploy-batch") result = await this.deployBatch(request, config, progress);
      else if (request.operation === "verify") result = await this.verify(request, config, pkg);
      else if (request.operation === "promote" && this.promote) result = await this.promote(request, config, pkg, progress);
      else if (request.operation === "reconcile") result = await this.reconcile(request, config, pkg, progress);
      else throw new Error("Operation is not available in this build");
      await atomicJson(resultPath, { ...journal, status: result.pending ? "pending" : result.superseded ? "superseded" : "completed",
        completedAt: result.pending ? undefined : new Date().toISOString(),
        error: result.pending ? result.profiles?.filter(p => p.status === "pending").map(p => p.reason).join("; ") : undefined, result });
    } catch (error) {
      const expired = Date.parse(request.expiresAt) <= Date.now();
      const retryablePromotion = request.operation === "promote"
        && ["VDB_BUILD_PENDING", "VDB_INACTIVE_GAME", "VDB_RETRYABLE"].includes(error.code);
      const waitingFinish = [2, 3].includes(request.protocolVersion) && request.operation === "finish" && !journal.deploymentStarted
        && ["VDB_INACTIVE_GAME", "VDB_INACTIVE_PROFILE", "VDB_WAITING"].includes(error.code);
      if (waitingFinish || retryablePromotion && !expired) {
        await atomicJson(resultPath, { ...journal, status: "pending", error: error.message,
          retryAfter: new Date(Date.now() + 5000).toISOString() });
      } else {
        await atomicJson(resultPath, { ...journal, status: expired ? "expired" : "failed", error: error.message, completedAt: new Date().toISOString() });
      }
    }
  }

  async tick() {
    if (this.busy) return false;
    this.busy = true;
    try {
      await lock(path.join(this.root, "consumer"), async () => {
      for (const file of await listJson(path.join(this.root, "requests"))) {
        try { await this.process(path.join(this.root, "requests", file)); }
        catch (error) { await atomicJson(path.join(this.root, "invalid", file), { error: error.message }); }
      }
      const receipts = [];
      for (const file of await listJson(path.join(this.root, "receipts"))) {
        const receipt = await readJson(path.join(this.root, "receipts", file));
        receipts.push({ id: receipt.id, projectId: receipt.projectId, packageId: receipt.packageId,
          operation: receipt.operation, status: receipt.status, startedAt: receipt.startedAt,
          error: receipt.error, phase: receipt.phase, staging: receipt.staging, deploymentStarted: receipt.deploymentStarted,
          deployment: receipt.result?.deployment, activation: receipt.result?.activation, skipped: receipt.result?.skipped, profiles: receipt.result?.profiles,
          verification: receipt.result?.verification || (receipt.operation === "verify" ? receipt.result : undefined) });
      }
      receipts.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
      const projects = [];
      for (const file of await listJson(path.join(this.root, "projects"))) {
        const registration = await readJson(path.join(this.root, "projects", file));
        projects.push({ id: registration.config.id, gameId: registration.config.gameId,
          packages: registration.config.packages.map(p => ({ id: p.id, name: p.displayName, activation: p.activation || "stage-only" })) });
      }
      await atomicJson(path.join(this.root, "status.json"), {
        protocolVersion: 1, extensionVersion: require("../../package.json").version,
        capabilities: ["stage", "deploy", "deploy-batch", "verify", "rollback", "promote", "reconcile", "durable-finish-v2", "profile-finish-v3"], observedAt: new Date().toISOString(),
        ...this.adapter.snapshot(), projects, receipts: receipts.slice(0, 100),
      });
      });
      return true;
    } finally { this.busy = false; }
  }
}

module.exports = { Engine, buildKey, listJson };
