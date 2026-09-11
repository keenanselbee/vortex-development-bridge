#!/usr/bin/env node
"use strict";

const { bridgeRoot } = require("../protocol/config");
const client = require("./client");
const queue = require("../protocol/queue");

const HELP = `Vortex Development Bridge
  vdb register --config <vdb.json>
  vdb doctor | status
  vdb stage --project <id> --package <id> --artifact <directory> --version <version> [--profile <id>]
  vdb deploy | rollback --project <id> --package <id> --build <id> --profile <id>
  vdb deploy-batch --project <id> --builds <selection.json> --profile <id>
  vdb verify --project <id> --package <id> --build <id> [--profile <id>]
  vdb promote --project <id> --package <id> --build <id> --receipt <release-journal.json>
  vdb reconcile --project <id> --package <id>
  vdb legacy-publication-dry-run --project <id> --package <id> --staged-id <id> --migration <migration-receipt.json>
  vdb legacy-publication-apply --project <id> --package <id> --staged-id <id> --migration <migration-receipt.json>
  vdb receipt --request <id>
  vdb wait --request <id> [--seconds 30]
All commands accept --bridge <queue-directory> and --json.
Staging requires a directory already arranged in its final Vortex staging layout.
Rollback explicitly activates a retained build; it never deletes versions.`;

function parse(argv) {
  const args = { command: argv[0] || "help" };
  const known = new Set(["config", "project", "package", "artifact", "version", "profile", "build", "builds", "request", "receipt", "migration", "staged-id", "seconds", "bridge", "json"]);
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (!argv[i].startsWith("--") || !known.has(key)) throw new Error(`Unknown argument: ${argv[i]}`);
    if (key === "json") args.json = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value: --${key}`);
      args[key] = argv[++i];
    }
  }
  return args;
}

async function main(argv) {
  const args = parse(argv);
  if (["help", "--help", "-h"].includes(args.command)) return HELP;
  const root = bridgeRoot(args.bridge);
  if (!args.project && ["stage", "deploy", "deploy-batch", "rollback", "verify", "promote", "reconcile", "legacy-publication-dry-run", "legacy-publication-apply"].includes(args.command)) {
    try { args.project = (await require("../protocol/config").project(args.config || "vdb.json")).config.id; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (args.project && !args.package && ["stage", "deploy", "rollback", "verify", "promote", "reconcile", "legacy-publication-dry-run", "legacy-publication-apply"].includes(args.command)) {
    const registration = await client.registered(root, args.project);
    if (registration.config.packages.length === 1) args.package = registration.config.packages[0].id;
  }
  const required = (...names) => { for (const name of names) if (!args[name]) throw new Error(`Missing --${name}`); };
  switch (args.command) {
    case "register": return client.register(root, args.config || "vdb.json");
    case "status": {
      const snapshot = await client.status(root);
      if (!args.project) return snapshot;
      return { ...snapshot, projects: snapshot.projects?.filter(p => p.id === args.project),
        managed: snapshot.managed?.filter(p => p.vdbProjectId === args.project),
        receipts: snapshot.receipts?.filter(p => p.projectId === args.project) };
    }
    case "doctor": return { clientVersion: require("../../package.json").version, protocolVersion: 1, bridgeRoot: root, vortex: await client.status(root) };
    case "stage":
      required("project", "package", "artifact", "version");
      return client.stage(root, args.project, args.package, args.artifact, args.version, args.profile);
    case "promote":
      required("project", "package", "build", "receipt");
      return client.promote(root, args.project, args.package, args.build, args.receipt);
    case "reconcile":
      required("project", "package");
      return client.reconcile(root, args.project, args.package);
    case "legacy-publication-dry-run":
    case "legacy-publication-apply":
      required("project", "package", "staged-id", "migration");
      return client.legacyPublicationMigration(root, args.project, args.package, args["staged-id"], args.migration,
        args.command === "legacy-publication-apply");
    case "deploy-batch": {
      required("project", "builds", "profile");
      const builds = await require("../protocol/files").readJson(args.builds);
      if (!Array.isArray(builds) || !builds.length) throw new Error("Build selection must be a nonempty JSON array");
      return client.submit(root, args.project, builds[0].packageId, "deploy-batch", { builds, profileId: args.profile });
    }
    case "deploy": case "rollback": case "verify":
      required("project", "package", "build");
      if (args.command !== "verify") required("profile");
      return client.submit(root, args.project, args.package, args.command === "rollback" ? "deploy" : args.command,
        { buildId: args.build, profileId: args.profile || null, rollback: args.command === "rollback" });
    case "receipt": required("request"); return queue.receipt(root, args.request);
    case "wait": {
      required("request");
      const seconds = Number(args.seconds || 30);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new Error("--seconds must be between 0 and 60");
      return queue.wait(root, args.request, seconds);
    }
    default: throw new Error(`Unknown command: ${args.command}`);
  }
}

function outcomeCode(result) {
  if (["failed", "expired", "interrupted"].includes(result?.status)) return 1;
  if (result?.waiting || result?.status === "pending") return 2;
  const verification = result?.result?.verification || result?.result;
  const items = Array.isArray(verification) ? verification : [verification];
  if (items.some(x => x?.deployed === "differences" || x?.enabled === false)) return 3;
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(result => {
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    process.exitCode = outcomeCode(result);
  }).catch(error => { console.error(JSON.stringify({ status: "failed", error: error.message })); process.exitCode = 1; });
}
module.exports = { main, parse, outcomeCode };
