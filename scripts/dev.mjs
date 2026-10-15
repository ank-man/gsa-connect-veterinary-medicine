// Zero-dependency local server.
//   npm run dev     → preview your card at http://localhost:4173
//   npm run setup   → same, plus the profile editor at /setup.html (opens automatically)
//
// The editor talks to the small API below, which only listens on 127.0.0.1:
//   GET  /api/card                 read card.json
//   POST /api/card                 save card.json
//   POST /api/upload?kind=photo|thumb|cv&ext=jpg   save an uploaded file into assets/
//   GET  /api/templates            list templates;  POST /api/template {id}  switch template
//   POST /api/publish              git add + commit + push
import { createServer } from "node:http";
import { readFile, writeFile, stat, readdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { applyTemplate, currentTemplate, loadCatalog } from "./template.mjs";

const run = promisify(execFile);
const args = process.argv.slice(2);
const setup = args.includes("--setup");
const sub = args.find((a) => !a.startsWith("--"));
const repo = resolve(import.meta.dirname, "..");
const root = resolve(repo, sub || ".");
const port = Number(process.env.PORT) || 4173;
const MAX = 15 * 1024 * 1024;
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".pdf": "application/pdf", ".vcf": "text/vcard", ".webmanifest": "application/manifest+json",
  ".pkpass": "application/vnd.apple.pkpass", ".ico": "image/x-icon"
};

const body = (req) => new Promise((ok, fail) => {
  const chunks = []; let n = 0;
  req.on("data", (c) => { n += c.length; if (n > MAX) { fail(new Error("File too large (15 MB max)")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => ok(Buffer.concat(chunks)));
  req.on("error", fail);
});
const json = (res, code, data) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(data));

async function api(req, res, url) {
  const cardPath = resolve(repo, "card.json");
  if (url.pathname === "/api/card" && req.method === "GET") {
    return json(res, 200, JSON.parse(await readFile(cardPath, "utf8")));
  }
  if (url.pathname === "/api/card" && req.method === "POST") {
    const card = JSON.parse((await body(req)).toString("utf8"));
    if (!card || typeof card.name !== "string") throw new Error("card.json needs a name");
    await writeFile(cardPath, JSON.stringify(card, null, 2) + "\n");
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/api/templates" && req.method === "GET") {
    const c = await loadCatalog(repo);
    return json(res, 200, { current: await currentTemplate(repo), previewBase: c.previewBase,
      themes: c.themes.map(({ id, name, group, layout, tagline, bestFor, accent }) => ({ id, name, group, layout, tagline, bestFor, accent })) });
  }
  if (url.pathname === "/api/template" && req.method === "POST") {
    const { id } = JSON.parse((await body(req)).toString("utf8"));
    const t = await applyTemplate({ root: repo, id });
    const card = JSON.parse(await readFile(cardPath, "utf8"));
    card.template = t.id;
    card.wallet = { ...card.wallet, ...(t.wallet || {}) };
    await writeFile(cardPath, JSON.stringify(card, null, 2) + "\n");
    return json(res, 200, { ok: true, id: t.id, name: t.name, wallet: card.wallet });
  }
  if (url.pathname === "/api/upload" && req.method === "POST") {
    const kind = url.searchParams.get("kind");
    const ext = (url.searchParams.get("ext") || "").toLowerCase();
    const allowed = { photo: ["jpg", "png", "webp"], thumb: ["png"], cv: ["pdf"] };
    if (!allowed[kind]?.includes(ext)) throw new Error(`Unsupported upload: ${kind}.${ext}`);
    const name = kind === "cv" ? "cv.pdf" : kind === "thumb" ? "wallet-thumbnail.png" : `photo.${ext}`;
    if (kind === "photo") { // remove old photo.* so only one remains
      for (const f of await readdir(resolve(repo, "assets"))) if (/^photo\./.test(f) && f !== name) await unlink(resolve(repo, "assets", f));
    }
    await writeFile(resolve(repo, "assets", name), await body(req));
    return json(res, 200, { ok: true, path: `assets/${name}` });
  }
  if (url.pathname === "/api/publish" && req.method === "POST") {
    const { message } = JSON.parse((await body(req)).toString("utf8") || "{}");
    const git = (...a) => run("git", a, { cwd: repo });
    try { await git("rev-parse", "--is-inside-work-tree"); } catch { throw new Error("This folder is not a git repo. Clone your repo with git first."); }
    await git("add", "-A");
    const { stdout: staged } = await git("diff", "--cached", "--name-only");
    if (staged.trim()) await git("commit", "-m", message || "Update my GSA Connect card");
    const { stdout: remote } = await git("remote");
    if (!remote.trim()) return json(res, 200, { ok: true, log: "Committed locally (no remote configured yet)." });
    const { stdout, stderr } = await git("push");
    let pages = "";
    try { const { stdout: u } = await git("remote", "get-url", "origin"); pages = pagesUrl(u.trim()); } catch {}
    return json(res, 200, { ok: true, log: (staged.trim() ? `Committed:\n${staged}` : "Nothing new to commit.\n") + stdout + stderr, pages });
  }
  json(res, 404, { error: "Unknown endpoint" });
}

function pagesUrl(remote) {
  const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
  if (!m) return "";
  const [, user, name] = m;
  return name.toLowerCase() === `${user.toLowerCase()}.github.io` ? `https://${name}/` : `https://${user}.github.io/${name}/`;
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    try { return await api(req, res, url); } catch (e) { return json(res, 400, { error: e.message }); }
  }
  let file = join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  const link = `http://localhost:${port}/${setup ? "setup.html" : ""}`;
  console.log(`\n  GSA Connect ${setup ? "setup" : "preview"} → ${link}\n  (Ctrl+C to stop)\n`);
  if (setup && !process.env.NO_OPEN) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    execFile(opener, [link], () => {});
  }
});
