// Push all-search-index.json into the search backend (Cloudflare Worker + D1).
// Run from a repo root after the index is built.
//
// Env:
//   SEARCH_API        base URL of the worker (skip if unset)
//   SEARCH_ADMIN_KEY  ADMIN_KEY secret
//   SOURCE            "vault" or "ledger"

import fs from "node:fs";

const api = (process.env.SEARCH_API || "").replace(/\/+$/, "");
const key = process.env.SEARCH_ADMIN_KEY;
const source = process.env.SOURCE;

if (!api) {
  console.log("SEARCH_API not set - skipping search backend sync.");
  process.exit(0);
}
if (!key || !source) {
  console.error("SEARCH_ADMIN_KEY and SOURCE are required when SEARCH_API is set.");
  process.exit(1);
}

const file = "all-search-index.json";
const rows = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(`syncing source=${source} rows=${rows.length} -> ${api}`);

const headers = { "content-type": "application/json", "x-admin-key": key };

let res = await fetch(`${api}/admin/reset`, {
  method: "POST", headers, body: JSON.stringify({ source }),
});
if (!res.ok) {
  console.error("reset failed:", res.status, await res.text());
  process.exit(1);
}

const CHUNK = 500;
for (let i = 0; i < rows.length; i += CHUNK) {
  const body = JSON.stringify({ source, rows: rows.slice(i, i + CHUNK) });
  res = await fetch(`${api}/admin/import`, { method: "POST", headers, body });
  if (!res.ok) {
    console.error("import failed:", res.status, await res.text());
    process.exit(1);
  }
  console.log(`imported ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
}
console.log("done.");
