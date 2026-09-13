"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { lock } = require("../../src/protocol/files");
const [root, mode] = process.argv.slice(2);
lock(root, async () => {
  if (mode === "race") {
    const marker = path.join(root, "active");
    const file = await fs.open(marker, "wx");
    await new Promise(resolve => setTimeout(resolve, 20));
    await file.close();
    await fs.unlink(marker);
    return;
  }
  if (mode === "exit") process.exit(0);
  process.send({ ready: true, pid: process.pid });
  await new Promise(resolve => process.once("message", resolve));
}, { waitMs: 10000 }).then(() => { process.disconnect?.(); }).catch(error => {
  console.error(error);
  process.exitCode = 1;
  process.disconnect?.();
});
