"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { local } = require("./release");
const { lock, atomicJson } = require("../protocol/files");

async function describe(repo, action = "review", options = {}) {
  const state = await local(repo);
  const n = state.manifest.nexus;
  const expected = `https://www.nexusmods.com/games/${n.gameDomain}/mods/${n.gameScopedModId}`;
  const legacy = `https://www.nexusmods.com/${n.gameDomain}/mods/${n.gameScopedModId}`;
  if (!n.gameScopedModId || ![expected, legacy].includes(n.url)) throw new Error("Configure a Nexus URL matching the page's domain and scoped mod ID");
  const toolRoot = path.resolve(__dirname, "../..");
  const scratch = path.join(state.repo, ".codex-temp", "nexus-browser");
  const port = Number(options.port || 9347);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid Chrome debugging port");
  const chrome = options.chrome || path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google/Chrome/Application/chrome.exe");
  await fs.access(chrome);
  return lock(scratch, async () => {
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", () => reject(new Error("Browser port is already in use; select another port instead of attaching to an unrelated browser")));
      server.listen(port, "127.0.0.1", () => server.close(resolve));
    });
    const profileRoot = path.join(scratch, "chrome-profile");
    const request = { action, nexusUrl: n.url, repoRoot: state.repo, packageName: state.manifest.packageName,
      displayName: state.manifest.displayName, browser: "Chrome", remoteDebuggingPort: port, profileRoot,
      backupRoot: path.join(scratch, "backups"), resultPath: path.join(scratch, "result.json"),
      desiredShortDescription: state.text.short, desiredFullDescription: state.text.full,
      sourceHashes: state.sourceHashes, timeoutSeconds: options.timeout || 180,
      restoreBackupPath: options.backup,
    };
    await atomicJson(path.join(scratch, "request.json"), request);
    const child = spawn(chrome, [`--user-data-dir=${profileRoot}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore", windowsHide: true });
    let launchError;
    child.on("error", error => { launchError = error; });
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ready) { child.kill(); throw new Error("Dedicated Chrome did not become ready; check its profile and executable path"); }
    const previous = process.env.NEXUS_DESCRIPTION_TOOL_ROOT;
    process.env.NEXUS_DESCRIPTION_TOOL_ROOT = toolRoot;
    try {
      const helper = await import(pathToFileURL(path.join(__dirname, "browser-editor.mjs")).href);
      await helper.runRequest(request);
      return JSON.parse(await fs.readFile(request.resultPath, "utf8"));
    } finally {
      if (previous === undefined) delete process.env.NEXUS_DESCRIPTION_TOOL_ROOT; else process.env.NEXUS_DESCRIPTION_TOOL_ROOT = previous;
      child.kill();
    }
  });
}
module.exports = { describe };
