import { createServer } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT) || 8788;
const host = process.env.HOST || "0.0.0.0";
const maintenanceOrigin = (process.env.MAINTENANCE_ORIGIN || "https://shaw-gardens.apps.grok.bot").replace(/\/+$/, "");
const token = process.env.PREVIEW_TOKEN || "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "Content-Length": payload.length,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    ...headers,
  });
  res.end(payload);
}

function text(res, status, body) {
  send(res, status, body, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
}

function redirect(res, location) {
  send(res, 303, "", { Location: location, "Cache-Control": "no-store" });
}

function sameOrigin(req) {
  const site = String(req.headers["sec-fetch-site"] || "").split(",")[0].trim().toLowerCase();
  if (site === "same-origin") return true;
  if (site === "cross-site" || site === "same-site") return false;
  const origin = String(req.headers.origin || "");
  if (!origin) return false;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const forwarded = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const hostHeader = String(req.headers.host || "").split(",")[0].trim();
  return originHost !== "" && (originHost === forwarded || originHost === hostHeader);
}

async function maintenance(path, method = "GET") {
  if (!token) return null;
  try {
    const response = await fetch(`${maintenanceOrigin}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    if (response.status === 204) return { ok: true };
    const type = response.headers.get("content-type") || "";
    if (type.startsWith("image/")) {
      return { type, bytes: Buffer.from(await response.arrayBuffer()) };
    }
    return await response.json();
  } catch {
    return null;
  }
}

function projectsHtml(projects) {
  if (!Array.isArray(projects) || projects.length === 0) return "<p>No projects yet.</p>";
  return projects.map((project) => {
    const id = esc(project.id);
    const version = esc(project.updatedAt || "");
    const pictures = [
      project.before ? `<figure><img src="/media/${id}/before?v=${version}" alt="Before"><figcaption>Before</figcaption></figure>` : "",
      project.after ? `<figure><img src="/media/${id}/after?v=${version}" alt="After"><figcaption>After</figcaption></figure>` : "",
    ].join("");
    const pair = pictures ? `<div class="pair">${pictures}</div>` : "";
    const notes = project.notes ? `<p>${esc(project.notes)}</p>` : "";
    const recommendations = project.recommendations
      ? `<h4>Recommendations</h4><p>${esc(project.recommendations)}</p>`
      : "";
    return `<article class="record"><h3>${esc(project.title || "Project")}</h3>${notes}${pair}${recommendations}</article>`;
  }).join("");
}

function bar(notice, previous) {
  const note = notice === "published"
    ? "The public site now shows this version."
    : notice === "reverted"
      ? "The public site is back on the previous version."
      : notice === "offline"
        ? "The preview could not update the public site."
        : "This is the private preview. The public site changes only when you publish.";
  const revert = previous
    ? `<form method="post" action="/revert" onsubmit="return confirm('Put the previous public version back?')"><button type="submit">Revert to previous version</button></form>`
    : "";
  return `<div class="preview-bar"><p>${note}</p><form method="post" action="/publish" onsubmit="return confirm('Publish this preview on the public site?')"><button type="submit">Publish Live</button></form>${revert}</div>`;
}

async function page(notice) {
  const edition = await maintenance("/api/edition");
  const html = await readFile(resolve(root, "index.html"), "utf8");
  return html
    .replace('<div id="preview-bar"></div>', bar(notice, Boolean(edition?.previous)))
    .replace('<div id="documented-list"><p>No projects yet.</p></div>', `<div id="documented-list">${projectsHtml(edition?.projects)}</div>`);
}

function staticFile(urlPath) {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const relative = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^[/\\]+/, "");
  const full = resolve(root, relative);
  if (full !== root && !full.startsWith(root + sep)) return null;
  const ext = extname(full).toLowerCase();
  if (!types.has(ext)) return null;
  return { full, type: types.get(ext) };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "POST" && (path === "/publish" || path === "/revert")) {
      if (!sameOrigin(req)) {
        text(res, 403, "Forbidden");
        return;
      }
      const target = path === "/publish" ? "/api/edition/publish" : "/api/edition/revert";
      const result = await maintenance(target, "POST");
      const notice = result ? (path === "/publish" ? "published" : "reverted") : "offline";
      redirect(res, `/?notice=${notice}`);
      return;
    }
    if (req.method === "GET" && path === "/") {
      const notice = url.searchParams.get("notice") || "";
      const allowed = ["published", "reverted", "offline"].includes(notice) ? notice : "";
      send(res, 200, await page(allowed), {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      });
      return;
    }
    const media = path.match(/^\/media\/([^/]+)\/(before|after)$/);
    if (req.method === "GET" && media && UUID.test(media[1])) {
      const image = await maintenance(`/api/edition/media/${media[1]}/${media[2]}`);
      if (!image?.bytes || !image.type) {
        text(res, 404, "Not found");
        return;
      }
      send(res, 200, image.bytes, { "Content-Type": image.type, "Cache-Control": "private, no-store" });
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      const file = staticFile(path);
      if (!file) {
        text(res, 404, "Not found");
        return;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": file.type, "X-Content-Type-Options": "nosniff" });
        res.end();
        return;
      }
      try {
        send(res, 200, await readFile(file.full), { "Content-Type": file.type, "Cache-Control": "no-cache" });
      } catch {
        text(res, 404, "Not found");
      }
      return;
    }
    text(res, 405, "Method not allowed");
  } catch {
    text(res, 500, "Something went wrong.");
  }
});

server.listen(port, host, () => {
  console.log(`Shaw Gardens preview listening on ${port}`);
});
