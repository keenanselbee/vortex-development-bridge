"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { atomicJson, readJson } = require("../src/protocol/files");
const { createZip } = require("../src/protocol/archive");
const { prepare, publish, local } = require("../src/publishing/release");
const { upload } = require("../src/publishing/api");

async function fixture(t) {
  const parent = path.resolve(".codex-temp/tests");
  await fs.mkdir(parent, { recursive: true });
  const repo = await fs.mkdtemp(path.join(parent, "publishing-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await atomicJson(path.join(repo, "package.json"), { version: "0.1.0", license: "MIT" });
  await atomicJson(path.join(repo, "mod.json"), { id: "example", displayName: "Example", releaseReady: true,
    nexus: { gameDomain: "site", gameScopedModId: "1", modId: "100", groupId: "200" } });
  for (const [file, value] of [["short", "Short"], ["file", "File"], ["full", "[b]Full[/b]"]]) await fs.writeFile(path.join(repo, `nexus-${file}-desc.txt`), value);
  await fs.writeFile(path.join(repo, "nexus-changelog.txt"), "TargetVersion=0.1.0\nBaselineVersion=none\nInitial release.\n");
  await fs.mkdir(path.join(repo, "payload"));
  await fs.writeFile(path.join(repo, "payload/index.js"), "example");
  const archive = path.join(repo, "Example.zip");
  await createZip(path.join(repo, "payload"), archive);
  const versions = [], calls = [];
  let failChangelog = false, failVerify = false;
  const invoke = async (method, route, body) => {
    calls.push({ method, route });
    if (method === "GET" && route.startsWith("/games/")) return { id: "100", game_scoped_id: "1" };
    if (method === "GET" && route === "/mods/100/files") return { mod_files: [{ id: "200", name: "Example" }] };
    if (method === "GET" && route === "/mod-files/200/versions") {
      if (failVerify && versions.length) { failVerify = false; throw new Error("network during verification"); }
      return { versions: [...versions] };
    }
    if (method === "POST" && route === "/mod-files/200/versions") {
      versions.push({ id: "v1", version: body.version, category: "main", game_scoped_id: "99" });
      return { version: { id: "v1" } };
    }
    if (method === "POST" && route === "/mods/100/changelogs") {
      if (failChangelog) throw new Error("unknown changelog outcome");
      return body;
    }
    throw new Error(`Unexpected fixture API call ${method} ${route}`);
  };
  return { repo, archive, invoke, calls, versions, failChangelog: () => { failChangelog = true; }, failVerify: () => { failVerify = true; } };
}

test("verified publication returns a receipt and never posts twice", async t => {
  const f = await fixture(t);
  const plan = await prepare(f.repo, f.archive, f.invoke);
  let uploads = 0;
  const uploader = async () => { uploads++; return "upload-id"; };
  const result = await publish(plan, f.invoke, uploader);
  assert.equal(result.status, "completed");
  assert.equal(result.receipt.gameScopedFileId, "99");
  await publish(plan, f.invoke, uploader);
  assert.equal(uploads, 1);
  assert.equal(f.calls.filter(x => x.method === "POST").length, 2);
  await assert.rejects(prepare(f.repo, f.archive, f.invoke), /already exists/);
});

test("known created version can resume verification without repeated writes", async t => {
  const f = await fixture(t);
  const plan = await prepare(f.repo, f.archive, f.invoke);
  f.failVerify();
  await assert.rejects(publish(plan, f.invoke, async () => "upload-id"), /network/);
  const result = await publish(plan, f.invoke, async () => { throw new Error("must not upload twice"); });
  assert.equal(result.status, "completed");
  assert.equal(f.calls.filter(x => x.method === "POST").length, 2);
});

test("uncertain changelog outcome blocks duplicates and records created version", async t => {
  const f = await fixture(t);
  const plan = await prepare(f.repo, f.archive, f.invoke);
  f.failChangelog();
  await assert.rejects(publish(plan, f.invoke, async () => "upload-id"), /unknown changelog/);
  await assert.rejects(publish(plan, f.invoke, async () => "upload-id"), /unknown outcome/);
  const files = await fs.readdir(path.join(f.repo, ".codex-temp/nexus-releases"));
  const journal = await readJson(path.join(f.repo, ".codex-temp/nexus-releases", files.find(x => x.endsWith(".json"))));
  assert.equal(journal.versionId, "v1");
});

test("local checks and source drift prevent accidental release", async t => {
  const f = await fixture(t);
  assert.equal((await local(f.repo)).pkg.version, "0.1.0");
  const plan = await prepare(f.repo, f.archive, f.invoke);
  await fs.writeFile(path.join(f.repo, "nexus-file-desc.txt"), "edited after review");
  await assert.rejects(publish(plan, f.invoke, async () => "upload-id"), /source changed/);
  assert.equal(f.calls.filter(x => x.method === "POST").length, 0);
});

test("single-part upload binds content MD5 and never passes API credentials to storage", async t => {
  const f = await fixture(t);
  const records = [];
  const invoke = async (method, route, body) => {
    records.push({ method, route, body });
    if (route === "/uploads") return { id: "upload-id", presigned_url: "https://storage.invalid/signed" };
    return { state: "available" };
  };
  const send = async (method, url, body, headers) => {
    assert.equal(method, "PUT");
    assert.ok(headers["Content-MD5"]);
    assert.equal(headers.apikey, undefined);
    return { text: "" };
  };
  assert.equal(await upload(f.archive, async () => {}, invoke, send), "upload-id");
  assert.match(records[0].body.md5, /^[a-f0-9]{32}$/);
});
