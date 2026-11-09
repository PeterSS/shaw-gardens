import { fileURLToPath } from "node:url";
import { chdir } from "node:process";
import { createServer } from "node:http";

chdir(fileURLToPath(new URL(".", import.meta.url)));
import { randomUUID } from "node:crypto";
import { extname, normalize, resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { asBuffer, sql } from "./src/db.mjs";
import {
  clearCookie,
  loginAllowed,
  loginFailed,
  passwordConfigured,
  passwordMatches,
  readSession,
  sameOrigin,
  sealSession,
  sessionCookie,
} from "./src/auth.mjs";
import { editorPage, loginPage } from "./src/pages.mjs";
import {
  liveStatus,
  pointer,
  publishDraft,
  publishedImage,
  publishedProjects,
  revertLive,
} from "./src/editions.mjs";

const root = resolve(process.cwd());
const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || "0.0.0.0";
const maxBody = 6 * 1024 * 1024;
const maxPicture = 2 * 1024 * 1024;
const staticTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pagesOrigin = "https://peterss.github.io";

const previewPage = "https://peterss.github.io/shaw-gardens/preview/";

function pagesRead(req, headers) {
  const shared = { Vary: "Origin", ...headers };
  if (req.headers.origin === pagesOrigin) {
    shared["Access-Control-Allow-Origin"] = pagesOrigin;
    shared["Access-Control-Allow-Credentials"] = "true";
  }
  return shared;
}

function previewCaller(req) {
  return req.headers.origin === pagesOrigin || sameOrigin(req);
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

function redirect(res, location, extra = {}) {
  send(res, 303, "", { Location: location, ...extra });
}

function html(res, status, body, extra = {}) {
  send(res, status, body, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...extra,
  });
}

function text(res, status, body) {
  send(res, status, body, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
}

function deny(req, res) {
  send(res, 401, "Sign in required.", pagesRead(req, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "private, no-store",
  }));
}

async function readRaw(req) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > maxBody) {
    const error = new Error("too large");
    error.status = 413;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBody) {
      const error = new Error("too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function formData(req) {
  const body = await readRaw(req);
  const type = req.headers["content-type"] || "";
  const header = new Headers();
  if (type) header.set("content-type", type);
  const request = new Request("http://localhost/form", { method: "POST", headers: header, body });
  return request.formData();
}

function pictureFrom(file) {
  if (!file || typeof file === "string" || file.size === 0) return { empty: true };
  if (file.size > maxPicture) return { error: true };
  return file.arrayBuffer().then((raw) => {
    const bytes = Buffer.from(raw);
    const type = imageType(bytes);
    if (!type) return { error: true };
    return { bytes, type };
  });
}

function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 6) {
    const mark = bytes.toString("ascii", 0, 6);
    if (mark === "GIF87a" || mark === "GIF89a") return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";
  return null;
}

function clientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

async function listProjects() {
  const rows = await sql(
    `select id, title, notes, recommendations,
            before_type is not null as before,
            after_type is not null as after,
            updated_at
     from projects
     order by updated_at desc`,
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    notes: row.notes,
    recommendations: row.recommendations,
    before: Boolean(row.before),
    after: Boolean(row.after),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

function projectJson(projects) {
  return JSON.stringify(projects.map((project) => ({
    id: project.id,
    title: project.title,
    notes: project.notes,
    recommendations: project.recommendations,
    before: project.before,
    after: project.after,
    updatedAt: project.updatedAt,
  })));
}

async function publicProjects(req, res) {
  const projects = await publishedProjects();
  send(res, 200, projectJson(projects), pagesRead(req, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  }));
}

async function liveState(req, res) {
  const live = await liveStatus();
  send(res, 200, JSON.stringify({ kind: live.kind === "site" ? "site" : "coming-soon" }), pagesRead(req, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  }));
}

function sendImage(req, res, row, cache) {
  const image = asBuffer(row?.image);
  const type = row?.type;
  if (!image || !type || !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) {
    text(res, 404, "Not found");
    return;
  }
  send(res, 200, image, pagesRead(req, {
    "Content-Type": type,
    "Cache-Control": cache,
  }));
}

async function media(req, res, id, which) {
  if (!UUID.test(id) || (which !== "before" && which !== "after")) {
    text(res, 404, "Not found");
    return;
  }
  sendImage(req, res, await publishedImage(id, which), "public, max-age=3600");
}

async function draftImage(id, which) {
  if (!UUID.test(id) || (which !== "before" && which !== "after")) return null;
  const rows = which === "before"
    ? await sql("select before_image as image, before_type as type from projects where id = $1", [id])
    : await sql("select after_image as image, after_type as type from projects where id = $1", [id]);
  return rows[0] || null;
}

async function saveProject(req, res) {
  const data = await formData(req);
  const idValue = String(data.get("id") || "");
  const editing = idValue !== "";
  if (editing && !UUID.test(idValue)) {
    redirect(res, "/maintain?error=missing");
    return;
  }
  const title = String(data.get("title") || "").trim();
  const notes = String(data.get("notes") || "").trim();
  const recommendations = String(data.get("recommendations") || "").trim();
  if (!title || title.length > 160 || notes.length > 8000 || recommendations.length > 8000) {
    redirect(res, "/maintain?error=title");
    return;
  }
  const before = await pictureFrom(data.get("before"));
  const after = await pictureFrom(data.get("after"));
  if (before.error || after.error) {
    redirect(res, "/maintain?error=picture");
    return;
  }
  if (!editing) {
    await sql(
      `insert into projects
        (id, title, notes, recommendations, before_image, before_type, after_image, after_type)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        title,
        notes,
        recommendations,
        before.empty ? null : before.bytes,
        before.empty ? null : before.type,
        after.empty ? null : after.bytes,
        after.empty ? null : after.type,
      ],
    );
    redirect(res, "/maintain");
    return;
  }
  const existing = await sql(
    "select id, before_image, before_type, after_image, after_type from projects where id = $1",
    [idValue],
  );
  if (existing.length === 0) {
    redirect(res, "/maintain?error=missing");
    return;
  }
  const current = existing[0];
  let beforeImage = asBuffer(current.before_image);
  let beforeType = current.before_type;
  let afterImage = asBuffer(current.after_image);
  let afterType = current.after_type;
  if (data.get("remove_before")) {
    beforeImage = null;
    beforeType = null;
  }
  if (data.get("remove_after")) {
    afterImage = null;
    afterType = null;
  }
  if (!before.empty) {
    beforeImage = before.bytes;
    beforeType = before.type;
  }
  if (!after.empty) {
    afterImage = after.bytes;
    afterType = after.type;
  }
  await sql(
    `update projects
     set title = $2, notes = $3, recommendations = $4,
         before_image = $5, before_type = $6, after_image = $7, after_type = $8,
         updated_at = now()
     where id = $1`,
    [idValue, title, notes, recommendations, beforeImage, beforeType, afterImage, afterType],
  );
  redirect(res, "/maintain");
}

async function deleteProject(req, res) {
  const data = await formData(req);
  const id = String(data.get("id") || "");
  if (!UUID.test(id)) {
    redirect(res, "/maintain?error=missing");
    return;
  }
  await sql("delete from projects where id = $1", [id]);
  redirect(res, "/maintain");
}

async function login(req, res) {
  const ip = clientIp(req);
  if (!loginAllowed(ip)) {
    redirect(res, "/maintain?error=limited");
    return;
  }
  const data = await formData(req);
  const next = String(data.get("next") || "");
  const dest = next === previewPage ? previewPage : "/maintain";
  const password = String(data.get("password") || "");
  if (!passwordConfigured()) {
    redirect(res, "/maintain?error=unconfigured");
    return;
  }
  if (!passwordMatches(password)) {
    loginFailed(ip);
    redirect(res, next === previewPage ? `/maintain?error=rejected&next=${encodeURIComponent(previewPage)}` : "/maintain?error=rejected");
    return;
  }
  const token = sealSession();
  redirect(res, dest, { "Set-Cookie": sessionCookie(token, req) });
}

function staticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const cleaned = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const relative = cleaned.replace(/^[/\\]+/, "");
  if (relative === "_preview" || relative.startsWith(`_preview${sep}`) || relative.startsWith("_preview/")) return null;
  const full = resolve(root, relative);
  if (full !== root && !full.startsWith(root + sep)) return null;
  const ext = extname(full).toLowerCase();
  if (!staticTypes.has(ext)) return null;
  return { full, type: staticTypes.get(ext) };
}

async function serveStatic(res, urlPath) {
  const file = staticPath(urlPath === "/" ? "/index.html" : urlPath);
  if (!file) {
    text(res, 404, "Not found");
    return;
  }
  try {
    const body = await readFile(file.full);
    send(res, 200, body, { "Content-Type": file.type, "Cache-Control": "no-cache" });
  } catch {
    text(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const authed = readSession(req);
    console.log(`${req.method} ${path}`);

    if (req.method === "GET" && path === "/api/live") {
      await liveState(req, res);
      return;
    }
    if (req.method === "GET" && path === "/api/projects") {
      await publicProjects(req, res);
      return;
    }
    if (req.method === "OPTIONS" && req.headers.origin === pagesOrigin) {
      send(res, 204, "", pagesRead(req, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Max-Age": "600",
      }));
      return;
    }
    if (req.method === "GET" && path === "/api/draft") {
      if (!authed || !previewCaller(req)) {
        deny(req, res);
        return;
      }
      const current = await pointer();
      send(res, 200, JSON.stringify({
        projects: JSON.parse(projectJson(await listProjects())),
        previous: Boolean(current.previous_id),
      }), pagesRead(req, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
      }));
      return;
    }
    const draftMatch = path.match(/^\/draft\/media\/([^/]+)\/(before|after)$/);
    if (req.method === "GET" && draftMatch) {
      if (!authed || !previewCaller(req)) {
        deny(req, res);
        return;
      }
      const row = await draftImage(draftMatch[1], draftMatch[2]);
      const image = asBuffer(row?.image);
      const type = row?.type;
      if (!image || !type || !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) {
        text(res, 404, "Not found");
        return;
      }
      send(res, 200, image, pagesRead(req, { "Content-Type": type, "Cache-Control": "private, no-store" }));
      return;
    }
    const mediaMatch = path.match(/^\/media\/([^/]+)\/(before|after)$/);
    if (req.method === "GET" && mediaMatch) {
      await media(req, res, mediaMatch[1], mediaMatch[2]);
      return;
    }
    if (req.method === "GET" && (path === "/maintain" || path === "/maintain.html")) {
      const next = url.searchParams.get("next") || "";
      if (!authed) {
        html(res, 200, loginPage(url.searchParams.get("error") || "", next === previewPage ? next : ""));
        return;
      }
      if (next === previewPage) {
        redirect(res, previewPage);
        return;
      }
      html(res, 200, editorPage(await listProjects(), url.searchParams.get("error") || ""));
      return;
    }
    if (req.method === "POST" && (path === "/api/publish" || path === "/api/revert")) {
      if (!authed || !previewCaller(req)) {
        deny(req, res);
        return;
      }
      if (path === "/api/publish") await publishDraft();
      else await revertLive();
      send(res, 204, "", pagesRead(req, { "Cache-Control": "no-store" }));
      return;
    }
    if (req.method === "POST") {
      if (!sameOrigin(req)) {
        text(res, 403, "Forbidden");
        return;
      }
      if (path === "/maintain/login") {
        await login(req, res);
        return;
      }
      if (!authed) {
        redirect(res, "/maintain?error=rejected");
        return;
      }
      if (path === "/maintain/logout") {
        redirect(res, "/maintain", { "Set-Cookie": clearCookie(req) });
        return;
      }
      if (path === "/maintain/save") {
        await saveProject(req, res);
        return;
      }
      if (path === "/maintain/delete") {
        await deleteProject(req, res);
        return;
      }
    }
    if (req.method === "GET" || req.method === "HEAD") {
      if (req.method === "HEAD") {
        res.writeHead(200, { "X-Content-Type-Options": "nosniff" });
        res.end();
        return;
      }
      await serveStatic(res, path);
      return;
    }
    text(res, 405, "Method not allowed");
  } catch (error) {
    const status = error.status || 500;
    if (status === 413) {
      text(res, 413, "That upload is too large.");
      return;
    }
    console.error("request failed");
    text(res, 500, "Something went wrong.");
  }
});

server.listen(port, host, () => {
  console.log(`Shaw Gardens listening on ${port}`);
});
