"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

async function runningProcesses() {
  if (process.platform !== "win32") throw new Error("Automatic deployment cannot verify running games on this platform");
  // Fixed, read-only process query. No request content is interpreted as shell code.
  const shell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = await execFileAsync(shell, ["-NoProfile", "-NonInteractive", "-Command",
    "Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object Name,ExecutablePath | ConvertTo-Json -Compress"],
  { windowsHide: true, timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  const entries = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  if (!Array.isArray(entries)) throw new Error("Process inspection did not return a complete process list");
  return entries;
}

function gameProcess(entries, gameRoot, executable) {
  const prefix = path.win32.resolve(gameRoot).toLowerCase().replace(/[\\/]+$/, "") + "\\";
  const name = path.win32.basename(executable).toLowerCase();
  return entries.some(entry => {
    if (entry.ExecutablePath) return path.win32.resolve(entry.ExecutablePath).toLowerCase().startsWith(prefix);
    // A protected process can hide its path. A matching executable name still blocks.
    return String(entry.Name).toLowerCase() === name;
  });
}

module.exports = { runningProcesses, gameProcess };
