"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const esbuild = require("esbuild");
const metadata = require("../package.json");
const { atomicJson, hash, inventory, fingerprint } = require("../src/protocol/files");
const { createZip } = require("../src/protocol/archive");

async function build() {
  const repo = path.resolve(__dirname, "..");
  const publicDocs = ["workflow.md", "protocol.md", "vortex-operations.md", "nexus-workflow.md", "test-matrix.md"];
  const sourceHashes = {};
  for (const directory of ["src", "examples", "schemas"]) {
    for (const file of await inventory(path.join(repo, directory))) sourceHashes[`${directory}/${file.path}`] = file.sha256;
  }
  for (const file of ["package.json", "package-lock.json", "README.md", "CHANGELOG.txt", "NOTICE.txt", "tools/build.js"]) sourceHashes[file] = await hash(path.join(repo, file));
  for (const file of publicDocs) sourceHashes[`docs/${file}`] = await hash(path.join(repo, "docs", file));
  try { sourceHashes.LICENSE = await hash(path.join(repo, "LICENSE")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const run = path.join(repo, "dist", `${metadata.version}-${Date.now()}`);
  const output = path.join(run, "extension");
  await fs.mkdir(output, { recursive: true });
  await esbuild.build({ entryPoints: [path.join(repo, "src/extension/index.js")], outfile: path.join(output, "index.js"),
    bundle: true, platform: "node", target: "node18", external: ["vortex-api", "react"], legalComments: "eof" });
  await esbuild.build({ entryPoints: [path.join(repo, "src/client/cli.js")], outfile: path.join(output, "client/vdb.cjs"),
    bundle: true, platform: "node", target: "node22", legalComments: "eof" });
  await atomicJson(path.join(output, "info.json"), { name: "Vortex Development Bridge", author: metadata.author, version: metadata.version, description: metadata.description });
  for (const file of ["README.md", "CHANGELOG.txt", "NOTICE.txt"]) await fs.copyFile(path.join(repo, file), path.join(output, file));
  await fs.mkdir(path.join(output, "licenses"));
  for (const dependency of ["yauzl", "yazl", "buffer-crc32", "pend"]) {
    await fs.copyFile(path.join(repo, "node_modules", dependency, "LICENSE"), path.join(output, "licenses", dependency + ".txt"));
  }
  try { await fs.copyFile(path.join(repo, "LICENSE"), path.join(output, "LICENSE")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await fs.cp(path.join(repo, "examples"), path.join(output, "examples"), { recursive: true });
  await fs.cp(path.join(repo, "schemas"), path.join(output, "schemas"), { recursive: true });
  await fs.mkdir(path.join(output, "docs"));
  for (const file of publicDocs) await fs.copyFile(path.join(repo, "docs", file), path.join(output, "docs", file));
  const archive = path.join(run, `Vortex Development Bridge ${metadata.version}.zip`);
  const files = await createZip(output, archive);
  for (const [file, expected] of Object.entries(sourceHashes)) if (await hash(path.join(repo, file)) !== expected) throw new Error("Source changed while building");
  const receipt = { version: metadata.version, archive, sha256: await hash(archive), size: (await fs.stat(archive)).size, files, sourceHashes, sourceFingerprint: fingerprint(sourceHashes), createdAt: new Date().toISOString() };
  await atomicJson(path.join(run, "build-receipt.json"), receipt);
  await atomicJson(path.join(repo, "dist/latest.json"), { run, ...receipt });
  console.log(JSON.stringify({ archive, version: metadata.version, files: files.length, sha256: receipt.sha256 }, null, 2));
  return receipt;
}
if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { build };
