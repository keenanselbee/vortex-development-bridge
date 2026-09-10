"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const yauzl = require("yauzl");
const yazl = require("yazl");
const { inside, inventory, differences } = require("./files");

async function inspectZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(error);
      const files = [], names = new Set();
      let total = 0;
      zip.on("error", reject);
      zip.on("end", () => resolve(files.sort((a, b) => a.path.localeCompare(b.path, "en"))));
      zip.on("entry", entry => {
        (async () => {
          if (entry.fileName.endsWith("/")) { inside("archive", entry.fileName.slice(0, -1)); zip.readEntry(); return; }
          inside("archive", entry.fileName);
          const key = entry.fileName.toLowerCase();
          if (names.has(key)) throw new Error(`Duplicate/colliding ZIP entry: ${entry.fileName}`);
          names.add(key);
          if ((entry.generalPurposeBitFlag & 1) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error("Encrypted entries and symbolic links are not supported");
          total += entry.uncompressedSize;
          if (total > 100 * 1024 ** 3 || files.length > 200000) throw new Error("Archive exceeds inspection limits");
          const stream = await new Promise((yes, no) => zip.openReadStream(entry, (err, value) => err ? no(err) : yes(value)));
          const digest = crypto.createHash("sha256");
          let size = 0;
          for await (const chunk of stream) { size += chunk.length; digest.update(chunk); }
          if (size !== entry.uncompressedSize) throw new Error("ZIP entry length mismatch");
          files.push({ path: entry.fileName, size, sha256: digest.digest("hex") });
          zip.readEntry();
        })().catch(err => { zip.close(); reject(err); });
      });
      zip.readEntry();
    });
  });
}

async function createZip(source, destination) {
  const before = await inventory(source);
  if (!before.length) throw new Error("Cannot package an empty directory");
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const zip = new yazl.ZipFile();
  zip.on("error", error => zip.outputStream.destroy(error));
  const finished = pipeline(zip.outputStream, fs.createWriteStream(destination, { flags: "wx" }));
  try {
    for (const file of before) zip.addFile(inside(source, file.path), file.path, { mtime: new Date("2000-01-01T00:00:00Z"), mode: 0o100644 });
    zip.end();
    await finished;
  } catch (error) { zip.outputStream.destroy(error); await finished.catch(() => {}); throw error; }
  if (differences(before, await inventory(source)).length || differences(before, await inspectZip(destination)).length) throw new Error("Package verification failed or source changed during packaging");
  return before;
}
module.exports = { createZip, inspectZip };
