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
  vdb verify --project <id> --package <id> --build <id> [--profile <id>]
  vdb receipt --request <id>
  vdb wait --request <id> [--seconds 30]
All commands accept --bridge <queue-directory> and --json.
Staging requires a directory already arranged in its final Vortex staging layout.
Rollback explicitly activates a retained build; it never deletes versions.`;

function parse(argv) {
  const args = { command: argv[0] || "help" };
  const known = new Set(["config", "project", "package", "artifact", "version", "profile", "build", "request", "seconds", "bridge", "json"]);
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
  const required = (...names) => { for (const name of names) if (!args[name]) throw new Error(`Missing --${name}`); };
  switch (args.command) {
    case "register": return client.register(root, args.config || "vdb.json");
    case "status": return client.status(root);
    case "doctor": return { clientVersion: require("../../package.json").version, protocolVersion: 1, bridgeRoot: root, vortex: await client.status(root) };
    case "stage":
      required("project", "package", "artifact", "version");
      return client.stage(root, args.project, args.package, args.artifact, args.version, args.profile);
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

if (require.main === module) {
  main(process.argv.slice(2)).then(result => {
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    if (["failed", "expired", "interrupted"].includes(result?.status)) process.exitCode = 1;
    else if (result?.waiting) process.exitCode = 2;
  }).catch(error => { console.error(JSON.stringify({ status: "failed", error: error.message })); process.exitCode = 1; });
}
module.exports = { main, parse };
