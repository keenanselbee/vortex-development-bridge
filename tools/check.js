"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.endsWith(".js")) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    else if (entry.name.endsWith(".json")) JSON.parse(fs.readFileSync(file, "utf8"));
  }
}
for (const directory of ["src", "tools", "tests", "schemas", "examples"]) visit(path.join(root, directory));
console.log("JavaScript syntax and authored JSON checks passed.");
