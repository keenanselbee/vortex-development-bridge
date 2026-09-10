"use strict";
const path = require("node:path");
const { local, remote, prepare, publish } = require("../src/publishing/release");
const { describe } = require("../src/publishing/browser");
const { api } = require("../src/publishing/api");
const { atomicJson, readJson } = require("../src/protocol/files");

async function main(argv) {
  const command = argv.shift() || "check";
  const args = {};
  const flags = new Set(["offline", "create-file", "save", "login", "publish"]);
  const known = new Set([...flags, "repo", "archive", "plan", "chrome", "port", "backup"]);
  while (argv.length) {
    const token = argv.shift();
    if (!token.startsWith("--") || !known.has(token.slice(2))) throw new Error(`Unknown argument: ${token}`);
    const key = token.slice(2);
    args[key] = flags.has(key) ? true : argv.shift();
    if (args[key] === undefined) throw new Error(`Missing value: ${token}`);
  }
  const repo = path.resolve(args.repo || path.join(__dirname, ".."));
  if (command === "check") {
    const state = await local(repo);
    return { version: state.pkg.version, releaseReady: state.manifest.releaseReady, license: state.pkg.license,
      lengths: Object.fromEntries(Object.entries(state.text).map(([key, value]) => [key, value.length])),
      identityConfigured: !!(state.manifest.nexus.url && state.manifest.nexus.modId && state.manifest.nexus.gameScopedModId) };
  }
  if (command === "status") {
    const state = await local(repo);
    if (!state.manifest.nexus.modId) return { status: "not-configured", version: state.pkg.version, descriptions: "Local files available; Nexus page is not configured" };
    const current = await remote(state.manifest);
    const rows = current.active.map(v => ({ version: v.version, id: v.id, category: v.category, localVersion: state.pkg.version }));
    return { versions: rows, descriptions: "Use description review for fresh browser comparison", fileGroupConfigured: !!state.manifest.nexus.groupId };
  }
  if (command === "catalog") {
    const state = await local(repo);
    const catalog = await api("GET", "/vortex/extensions", undefined, { public: true });
    const id = state.manifest.nexus.gameScopedModId;
    const matches = (catalog.extensions || []).filter(x => id && String(x.mod_id) === String(id));
    return { pageConfigured: !!id, listed: matches.length > 0, localVersion: state.pkg.version,
      entries: matches, observedAt: new Date().toISOString() };
  }
  if (command === "descriptions") return describe(repo, args.backup ? args.save ? "revert-save" : "revert-review" : args.login ? "login" : args.save ? "save" : "review", args);
  if (command === "prepare") {
    const archive = args.archive || (await readJson(path.join(repo, "dist/latest.json"))).archive;
    const plan = await prepare(repo, archive, api, { offline: args.offline, createFile: args["create-file"] });
    const file = path.resolve(args.plan || path.join(repo, ".codex-temp", "nexus-plan.json"));
    await atomicJson(file, plan);
    return { status: plan.status, version: plan.version, archive: plan.archive, sha256: plan.sha256, plan: file, baseline: plan.baseline };
  }
  if (command === "publish") {
    if (!args.publish) throw new Error("Pass --publish to perform the reviewed remote update");
    const plan = await readJson(path.resolve(args.plan || path.join(repo, ".codex-temp", "nexus-plan.json")));
    return publish(plan);
  }
  throw new Error("Commands: check, status, catalog, descriptions, prepare, publish");
}
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
