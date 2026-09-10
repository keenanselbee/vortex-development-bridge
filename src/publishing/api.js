"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { hash } = require("../protocol/files");
const BASE = "https://api.nexusmods.com/v3";

async function api(method, route, body, options = {}) {
  if (!route.startsWith("/") || route.startsWith("//")) throw new Error("Invalid API route");
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (!options.public) {
    const key = process.env.NEXUS_API_KEY?.trim();
    if (!key) throw new Error("Set NEXUS_API_KEY in the publishing environment");
    headers.apikey = key;
  }
  let response;
  try {
    response = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(60000) });
  } catch { throw new Error(`Nexus ${method} request did not return a response; inspect the journal before retrying a write`); }
  if (!response.ok) throw new Error(`Nexus ${method} failed (HTTP ${response.status}); inspect the journal before retrying`);
  if (response.status === 204) return {};
  const document = await response.json();
  if (!document || document.data === undefined) throw new Error("Unexpected Nexus response shape");
  return document.data;
}

async function storage(method, url, body, headers) {
  if (new URL(url).protocol !== "https:") throw new Error("Upload storage must use HTTPS");
  let response;
  try { response = await fetch(url, { method, body, headers, redirect: "error", signal: AbortSignal.timeout(180000) }); }
  catch { throw new Error("Upload storage request failed; signed URL omitted"); }
  if (!response.ok) throw new Error(`Upload storage failed (HTTP ${response.status}); signed URL omitted`);
  return { etag: response.headers.get("etag"), text: await response.text() };
}

async function upload(archive, progress, invoke = api, send = storage) {
  const size = (await fs.stat(archive)).size;
  let result;
  if (size <= 64 * 1024 * 1024) {
    const md5 = await hash(archive, "md5");
    result = await invoke("POST", "/uploads", { filename: path.basename(archive), size_bytes: size, md5 });
    if (!/^[a-zA-Z0-9-]+$/.test(result.id || "")) throw new Error("Unexpected upload ID");
    await progress({ phase: "upload-created", uploadId: result.id });
    await send("PUT", result.presigned_url, await fs.readFile(archive), { "Content-Type": "application/octet-stream", "Content-MD5": Buffer.from(md5, "hex").toString("base64") });
  } else {
    result = await invoke("POST", "/uploads/multipart", { filename: path.basename(archive), size_bytes: size });
    if (!/^[a-zA-Z0-9-]+$/.test(result.id || "")) throw new Error("Unexpected upload ID");
    const partSize = result.part_size_bytes;
    if (!Number.isInteger(partSize) || partSize < 1 || partSize > 128 * 1024 * 1024 || result.part_presigned_urls?.length !== Math.ceil(size / partSize)) throw new Error("Unexpected multipart upload layout");
    await progress({ phase: "upload-created", uploadId: result.id });
    const handle = await fs.open(archive, "r");
    const parts = [];
    try {
      for (let i = 0; i < result.part_presigned_urls.length; i++) {
        const buffer = Buffer.alloc(Math.min(partSize, size - i * partSize));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, i * partSize);
        if (bytesRead !== buffer.length) throw new Error("Archive changed or could not be read fully");
        const response = await send("PUT", result.part_presigned_urls[i], buffer, { "Content-Type": "application/octet-stream" });
        if (!/^"?[a-fA-F0-9-]+"?$/.test(response.etag || "")) throw new Error("Unexpected multipart ETag");
        parts.push(`<Part><PartNumber>${i + 1}</PartNumber><ETag>${response.etag.replace(/"/g, "")}</ETag></Part>`);
      }
    } finally { await handle.close(); }
    const completed = await send("POST", result.complete_presigned_url, `<CompleteMultipartUpload>${parts.join("")}</CompleteMultipartUpload>`, { "Content-Type": "application/xml" });
    if (/<(?:\w+:)?Error[\s>]/.test(completed.text)) throw new Error("Storage rejected multipart completion");
  }
  await progress({ phase: "finalising-upload", uploadId: result.id });
  await invoke("POST", `/uploads/${result.id}/finalise`);
  const deadline = Date.now() + 180000;
  do {
    const current = await invoke("GET", `/uploads/${result.id}`);
    if (current.state === "available") return result.id;
    if (Date.now() >= deadline) throw new Error("Upload is still processing; inspect the journal before resuming");
    await new Promise(resolve => setTimeout(resolve, 2000));
  } while (true);
}
module.exports = { api, storage, upload };
