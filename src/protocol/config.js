"use strict";

const path = require("node:path");
const { readJson } = require("./files");
const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function identifier(value, label) {
  if (!ID.test(value || "")) throw new Error(`Invalid ${label}; use lowercase letters, digits, dots, underscores or hyphens`);
}

function validateProject(value) {
  if (value.schemaVersion !== 1) throw new Error("Unsupported project schemaVersion");
  identifier(value.id, "project ID");
  identifier(value.gameId, "game ID");
  if (!Array.isArray(value.packages) || value.packages.length === 0) throw new Error("Project needs packages");
  const ids = new Set();
  for (const pkg of value.packages) {
    identifier(pkg.id, "package ID");
    if (ids.has(pkg.id)) throw new Error(`Duplicate package ID: ${pkg.id}`);
    ids.add(pkg.id);
    if (!pkg.displayName || typeof pkg.displayName !== "string") throw new Error("Package needs displayName");
    if (!["stage-only", "replace-enabled-version"].includes(pkg.activation || "stage-only")) throw new Error("Invalid activation policy");
    if (pkg.modType !== undefined && typeof pkg.modType !== "string") throw new Error("modType must be a string");
    if (pkg.installation !== "prepared-directory") throw new Error("Use installation: prepared-directory; provide the final Vortex staging layout");
  }
  return value;
}

async function project(file) {
  const configPath = path.resolve(file);
  return { configPath, root: path.dirname(configPath), config: validateProject(await readJson(configPath)) };
}

function bridgeRoot(override) {
  if (override) return path.resolve(override);
  if (!process.env.APPDATA) throw new Error("APPDATA is unavailable; pass --bridge <directory>");
  return path.join(process.env.APPDATA, "Vortex", "vortex-development-bridge");
}

module.exports = { identifier, validateProject, project, bridgeRoot, VERSION };
