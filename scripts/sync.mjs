// Map-driven archive sync: reads channels.csv, exports each channel with DCE,
// mirrors user-uploaded attachments to R2, builds branch+sub-tagged indexes, and
// pushes to the search backend.
//
// Env:
//   SOURCE            "vault" | "ledger" (required)
//   TERM              term slug for this run (required)
//   BOT_TOKEN         Discord bot token (required)
//   DCE               DCE CLI command (default "DiscordChatExporter.Cli")
//   BRANCH / SERVER   optional filters (only export rows matching)
//   SEARCH_API        backend base URL (required for media + sync)
//   SEARCH_ADMIN_KEY  backend admin key
//
// Map file (channels.csv), columns: Server,Branch,Subbranch,ChannelID,Label
// Blank Subbranch is treated as "main". Provider/embed images are left as-is.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SOURCE = process.env.SOURCE;
const TERM = process.env.TERM;
const TOKEN = process.env.BOT_TOKEN;
const DCE = process.env.DCE || "DiscordChatExporter.Cli";
const API = (process.env.SEARCH_API || "").replace(/\/+$/, "");
const ADMIN_KEY = process.env.SEARCH_ADMIN_KEY;
const ROOT = "archives";
const MAP_FILE = "channels.csv";

if (!SOURCE || !TERM || !TOKEN) {
  console.error("SOURCE, TERM and BOT_TOKEN are required.");
  process.exit(1);
}

function readCsv(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift().split(",").map((s) => s.trim());
  return lines.map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = (cells[i] || "").trim()));
    return row;
  });
}

const all = readCsv(MAP_FILE).filter((r) => /^\d+$/.test(r.ChannelID || ""));
if (!all.length) { console.error("channels.csv has no valid rows."); process.exit(1); }

const map = {};
for (const r of all) map[r.ChannelID] = { branch: r.Branch || "misc", sub: r.Subbranch || "main" };

let rows = all;
if (process.env.BRANCH) rows = rows.filter((r) => (r.Branch || "misc") === process.env.BRANCH);
if (process.env.SERVER) rows = rows.filter((r) => r.Server === process.env.SERVER);
if (!rows.length) { console.log("No channels match the filter - nothing to export."); process.exit(0); }

// 1) Export
for (const r of rows) {
  if (/^(yes|true|1)$/i.test(r.Frozen || "")) {
    console.log(`skip frozen ${r.Label || r.ChannelID} (${r.ChannelID})`);
    continue;
  }
  const branch = r.Branch || "misc";
  const outDir = path.join(ROOT, branch, TERM);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`export ${SOURCE}/${branch}/${r.Subbranch || "main"}/${r.Label || r.ChannelID} (${r.ChannelID})`);
  try {
    execFileSync(DCE, [
      "export", "-t", TOKEN, "-c", r.ChannelID, "-f", "Json",
      "--include-threads", "all", "-o", path.join(outDir, "%c.json"),
    ], { stdio: "inherit" });
  } catch {
    console.warn(`  export failed for ${r.ChannelID} (${r.Label || ""}) - channel deleted or inaccessible; keeping existing archive.`);
  }
}

// 2) Mirror user-upload attachments to R2 (skip if already stored)
const safeName = (s) => String(s || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
const mediaUrl = (key) => API + "/media/" + key.split("/").map(encodeURIComponent).join("/");

async function mirror(cdnUrl, key) {
  try {
    const head = await fetch(mediaUrl(key), { method: "HEAD" });
    if (head.ok) return mediaUrl(key);
  } catch { /* fall through and upload */ }
  const res = await fetch(cdnUrl);
  if (!res.ok) throw new Error("cdn " + res.status);
  const buf = await res.arrayBuffer();
  const type = res.headers.get("content-type") || "application/octet-stream";
  const up = await fetch(`${API}/admin/media`, {
    method: "POST",
    headers: { "x-admin-key": ADMIN_KEY, "x-media-key": key, "x-media-type": type },
    body: buf,
  });
  if (!up.ok) throw new Error("upload " + up.status);
  return (await up.json()).url;
}

// 3) Build indexes (tag each message; rewrite attachment URLs to R2)
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".json") && entry.name !== "index.json") out.push(full);
  }
  return out;
}

const termRows = new Map();
const branchRows = new Map();
const allRows = [];
let mirrored = 0, mirrorFailed = 0;

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep);
  const branch = rel[0];
  const term = rel[1];
  let j;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
  if (!j || !Array.isArray(j.messages)) continue;
  const channelId = j.channel && j.channel.id ? String(j.channel.id) : "";
  const info = map[channelId] || { branch, sub: "main" };

  for (const m of j.messages) {
    const attachments = [];
    let idx = 0;
    for (const a of m.attachments || []) {
      let url = a.url;
      if (API && ADMIN_KEY && url) {
        const key = `${SOURCE}/${channelId}/${m.id}/${idx}-${safeName(a.fileName)}`;
        try { url = await mirror(url, key); mirrored++; }
        catch (e) { mirrorFailed++; console.error(`media failed for ${m.id}: ${e.message}`); }
      }
      attachments.push({ name: a.fileName, size: a.fileSizeBytes, url });
      idx++;
    }
    const embeds = (m.embeds || []).map((e) => ({
      title: e.title || "", description: e.description || "", url: e.url || "",
      image: (e.image && e.image.url) || (e.thumbnail && e.thumbnail.url) || "",
      video: (e.video && e.video.url) || "", provider: (e.provider && e.provider.name) || "",
    }));
    const searchtext = [
      m.content || "",
      ...attachments.map((a) => a.name || ""),
      ...embeds.map((e) => e.title),
      ...embeds.map((e) => e.description),
    ].join(" ").trim();
    const row = {
      content: m.content, searchtext, attachments, embeds,
      author: m.author ? m.author.name : "unknown",
      channel: j.channel ? j.channel.name : "",
      branch: info.branch, sub: info.sub, term,
      timestamp: m.timestamp, id: m.id,
    };
    const tk = info.branch + "\u0000" + term;
    if (!termRows.has(tk)) termRows.set(tk, []);
    termRows.get(tk).push(row);
    if (!branchRows.has(info.branch)) branchRows.set(info.branch, []);
    branchRows.get(info.branch).push(row);
    allRows.push(row);
  }
}

for (const [key, r] of termRows) {
  const [branch, term] = key.split("\u0000");
  fs.writeFileSync(path.join(ROOT, branch, term, "index.json"), JSON.stringify(r), "utf8");
}
for (const [branch, r] of branchRows) {
  fs.writeFileSync(path.join(ROOT, branch, "index.json"), JSON.stringify(r), "utf8");
}
fs.writeFileSync("all-search-index.json", JSON.stringify(allRows), "utf8");
console.log(`index: ${allRows.length} messages; media mirrored ${mirrored}, failed ${mirrorFailed}`);

// 4) Push to the search backend
if (!API) { console.log("SEARCH_API not set - skipping backend sync."); process.exit(0); }
if (!ADMIN_KEY) { console.error("SEARCH_ADMIN_KEY required when SEARCH_API is set."); process.exit(1); }

const headers = { "content-type": "application/json", "x-admin-key": ADMIN_KEY };
let res = await fetch(`${API}/admin/reset`, { method: "POST", headers, body: JSON.stringify({ source: SOURCE }) });
if (!res.ok) { console.error("reset failed:", res.status, await res.text()); process.exit(1); }
const CHUNK = 500;
for (let i = 0; i < allRows.length; i += CHUNK) {
  const body = JSON.stringify({ source: SOURCE, rows: allRows.slice(i, i + CHUNK) });
  res = await fetch(`${API}/admin/import`, { method: "POST", headers, body });
  if (!res.ok) { console.error("import failed:", res.status, await res.text()); process.exit(1); }
  console.log(`imported ${Math.min(i + CHUNK, allRows.length)}/${allRows.length}`);
}
console.log("done.");
