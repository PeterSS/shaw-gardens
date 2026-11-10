import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const REPO = "PeterSS/shaw-gardens";
const DRAFT_BRANCH = "drafts";
const SITE_BRANCH = "cursor/shaw-gardens-site-b948";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE = 3 * 1024 * 1024;
const EXTENSIONS = ["jpg", "png", "gif", "webp"];
const EXTENSION_TYPE = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};
const TYPE_EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

let queue = Promise.resolve();

function locked(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(() => {}, () => {});
  return run;
}

export function repositoryReady() {
  return (process.env.GH_TOKEN ?? "").trim().length > 0;
}

function useGitHub() {
  return process.env.STORE !== "local" && repositoryReady();
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function extension(type) {
  return TYPE_EXTENSION[type] || "";
}

function safeParts(rel) {
  const parts = String(rel).split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === ".." || part.includes("\\"))) {
    throw new Error("bad path");
  }
  return parts;
}

function localRoot() {
  return resolve(process.env.STORE_ROOT || resolve(process.cwd(), ".local-store"));
}

function localFile(area, rel) {
  const base = resolve(localRoot(), area);
  const full = resolve(base, ...safeParts(rel));
  if (full !== base && !full.startsWith(base + sep)) throw new Error("bad path");
  return full;
}

async function readLocal(area, rel) {
  try {
    const bytes = await readFile(localFile(area, rel));
    if (bytes.length > MAX_FILE) throw new Error("repository update failed");
    return bytes;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeLocal(area, rel, bytes) {
  const file = localFile(area, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

async function removeLocal(area, rel) {
  await rm(localFile(area, rel), { force: true });
}

async function listLocal(area, prefix) {
  const base = resolve(localRoot(), area);
  const found = [];
  async function walk(dir, rel) {
    const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(resolve(dir, entry.name), next);
      else if (entry.isFile()) found.push(next);
    }
  }
  await walk(base, "");
  return found.filter((path) => path.startsWith(prefix));
}

async function github(pathname, { method = "GET", body, missingOk = false } = {}) {
  const token = (process.env.GH_TOKEN ?? "").trim();
  const response = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "shaw-gardens",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 404 && missingOk) return null;
  if (!response.ok) {
    const error = new Error("repository update failed");
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

async function blobBytes(sha) {
  const data = await github(`/repos/${REPO}/git/blobs/${sha}`);
  const bytes = data.encoding === "base64"
    ? Buffer.from(String(data.content).replace(/\n/g, ""), "base64")
    : Buffer.from(String(data.content), "utf8");
  if (bytes.length > MAX_FILE) throw new Error("repository update failed");
  return bytes;
}

async function branchState(branch) {
  const ref = await github(`/repos/${REPO}/git/ref/heads/${branch}`, { missingOk: true });
  if (!ref) return null;
  const commit = await github(`/repos/${REPO}/git/commits/${ref.object.sha}`);
  const tree = await github(`/repos/${REPO}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error("repository update failed");
  return {
    sha: ref.object.sha,
    treeSha: commit.tree.sha,
    files: (tree.tree || []).filter((item) => item.type === "blob"),
  };
}

async function ensureDraftBranch() {
  if (await branchState(DRAFT_BRANCH)) return;
  const blob = await github(`/repos/${REPO}/git/blobs`, {
    method: "POST",
    body: { content: Buffer.from("[]\n").toString("base64"), encoding: "base64" },
  });
  const tree = await github(`/repos/${REPO}/git/trees`, {
    method: "POST",
    body: { tree: [{ path: "projects.json", mode: "100644", type: "blob", sha: blob.sha }] },
  });
  const commit = await github(`/repos/${REPO}/git/commits`, {
    method: "POST",
    body: { message: "Start the Shaw Gardens draft", tree: tree.sha, parents: [] },
  });
  try {
    await github(`/repos/${REPO}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${DRAFT_BRANCH}`, sha: commit.sha },
    });
  } catch (error) {
    if (error.status !== 422 && error.status !== 409) throw error;
  }
}

async function commitBranch(branch, writes, deletes, message) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const state = await branchState(branch);
      if (!state) throw new Error("repository update failed");
      const entries = [];
      for (const file of writes) {
        const blob = await github(`/repos/${REPO}/git/blobs`, {
          method: "POST",
          body: { content: file.bytes.toString("base64"), encoding: "base64" },
        });
        entries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
      }
      const present = new Set(state.files.map((file) => file.path));
      for (const path of deletes) {
        if (!present.has(path)) continue;
        entries.push({ path, mode: "100644", type: "blob", sha: null });
      }
      if (entries.length === 0) return;
      const tree = await github(`/repos/${REPO}/git/trees`, {
        method: "POST",
        body: { base_tree: state.treeSha, tree: entries },
      });
      const commit = await github(`/repos/${REPO}/git/commits`, {
        method: "POST",
        body: { message, tree: tree.sha, parents: [state.sha] },
      });
      await github(`/repos/${REPO}/git/refs/heads/${branch}`, {
        method: "PATCH",
        body: { sha: commit.sha, force: false },
      });
      return;
    } catch (error) {
      if (error.status !== 422 || attempt === 2) throw error;
    }
  }
}

function checkProject(project) {
  if (!project || typeof project !== "object") return null;
  if (!UUID.test(project.id)) return null;
  if (typeof project.title !== "string" || typeof project.notes !== "string") return null;
  if (typeof project.recommendations !== "string" || typeof project.updatedAt !== "string") return null;
  const before = project.before ?? null;
  const after = project.after ?? null;
  if (before !== null && !extension(before)) return null;
  if (after !== null && !extension(after)) return null;
  return {
    id: project.id,
    title: project.title,
    notes: project.notes,
    recommendations: project.recommendations,
    updatedAt: project.updatedAt,
    before,
    after,
  };
}

function view(project) {
  return {
    id: project.id,
    title: project.title,
    notes: project.notes,
    recommendations: project.recommendations,
    before: Boolean(project.before),
    after: Boolean(project.after),
    updatedAt: project.updatedAt,
  };
}

function publicRecord(project) {
  return {
    id: project.id,
    title: project.title,
    notes: project.notes,
    recommendations: project.recommendations,
    updatedAt: project.updatedAt,
    before: project.before ? `published/media/${project.id}/before.${extension(project.before)}` : null,
    after: project.after ? `published/media/${project.id}/after.${extension(project.after)}` : null,
  };
}

async function loadProjects() {
  let bytes;
  if (useGitHub()) {
    await ensureDraftBranch();
    const state = await branchState(DRAFT_BRANCH);
    const entry = state.files.find((file) => file.path === "projects.json");
    bytes = entry ? await blobBytes(entry.sha) : Buffer.from("[]");
  } else {
    bytes = await readLocal("drafts", "projects.json");
    if (!bytes) return [];
  }
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(parsed)) throw new Error("repository update failed");
  const projects = parsed.map(checkProject);
  if (projects.some((project) => !project)) throw new Error("repository update failed");
  return projects;
}

async function readDraftBytes(rel) {
  if (useGitHub()) {
    const state = await branchState(DRAFT_BRANCH);
    const entry = state?.files.find((file) => file.path === rel);
    return entry ? blobBytes(entry.sha) : null;
  }
  return readLocal("drafts", rel);
}

async function commitDraft(writes, deletes, message) {
  if (useGitHub()) {
    await ensureDraftBranch();
    await commitBranch(DRAFT_BRANCH, writes, deletes, message);
    return;
  }
  for (const file of writes) await writeLocal("drafts", file.path, file.bytes);
  for (const path of deletes) await removeLocal("drafts", path);
}

function picturePaths(id, which, keep) {
  const deletes = [];
  let write = null;
  for (const candidate of EXTENSIONS) {
    const path = `media/${id}/${which}.${candidate}`;
    if (keep && candidate === keep) write = path;
    else deletes.push(path);
  }
  return { write, deletes };
}

async function saveDraftUnlocked(input) {
  if (!UUID.test(input.id)) return false;
  if (input.before && !extension(input.before.type)) return false;
  if (input.after && !extension(input.after.type)) return false;
  const projects = await loadProjects();
  const index = projects.findIndex((project) => project.id === input.id);
  if (input.creating && index !== -1) return false;
  if (!input.creating && index === -1) return false;
  const record = {
    id: input.id,
    title: input.title,
    notes: input.notes,
    recommendations: input.recommendations,
    updatedAt: new Date().toISOString(),
    before: input.before ? input.before.type : null,
    after: input.after ? input.after.type : null,
  };
  if (index === -1) projects.push(record);
  else projects[index] = record;
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const writes = [{ path: "projects.json", bytes: jsonBytes(projects) }];
  const deletes = [];
  for (const which of ["before", "after"]) {
    const image = input[which];
    const planned = picturePaths(input.id, which, image ? extension(image.type) : "");
    deletes.push(...planned.deletes);
    if (image && planned.write) writes.push({ path: planned.write, bytes: image.bytes });
  }
  await commitDraft(writes, deletes, input.creating ? "Save a draft project" : "Update a draft project");
  return true;
}

async function deleteDraftUnlocked(id) {
  if (!UUID.test(id)) return false;
  const projects = await loadProjects();
  const next = projects.filter((project) => project.id !== id);
  if (next.length === projects.length) return true;
  const deletes = [];
  for (const which of ["before", "after"]) deletes.push(...picturePaths(id, which, "").deletes);
  await commitDraft(
    [{ path: "projects.json", bytes: jsonBytes(next) }],
    deletes,
    "Remove a draft project",
  );
  return true;
}

async function readDraftUnlocked(id) {
  if (!UUID.test(id)) return null;
  const project = (await loadProjects()).find((item) => item.id === id);
  if (!project) return null;
  const before = await imagePair(project, "before");
  const after = await imagePair(project, "after");
  return { ...project, before, after };
}

async function imagePair(project, which) {
  const type = project[which];
  if (!type) return null;
  const bytes = await readDraftBytes(`media/${project.id}/${which}.${extension(type)}`);
  if (!bytes) return null;
  return { bytes, type };
}

async function listDraftsUnlocked() {
  return (await loadProjects()).map(view);
}

async function draftImageUnlocked(id, which) {
  if (!UUID.test(id) || (which !== "before" && which !== "after")) return null;
  const project = (await loadProjects()).find((item) => item.id === id);
  if (!project?.[which]) return null;
  const bytes = await readDraftBytes(`media/${id}/${which}.${extension(project[which])}`);
  if (!bytes) return null;
  return { image: bytes, type: project[which] };
}

async function siteBytes(rel) {
  if (useGitHub()) {
    const state = await branchState(SITE_BRANCH);
    const entry = state?.files.find((file) => file.path === `published/${rel}`);
    return entry ? blobBytes(entry.sha) : null;
  }
  return readLocal("site", `published/${rel}`);
}

async function liveKind() {
  const bytes = await siteBytes("live.json");
  if (!bytes) return "coming-soon";
  const parsed = JSON.parse(bytes.toString("utf8"));
  return parsed.kind === "site" ? "site" : "coming-soon";
}

async function publishedList() {
  if (await liveKind() !== "site") return [];
  const bytes = await siteBytes("projects.json");
  if (!bytes) return [];
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(parsed)) return [];
  return parsed;
}

function publishedPath(project, which) {
  const path = project?.[which];
  if (typeof path !== "string") return "";
  const match = new RegExp(`^published/media/${project.id}/${which}\\.(jpg|png|gif|webp)$`).test(path);
  return match ? path : "";
}

async function currentSiteFiles() {
  const files = new Map();
  if (useGitHub()) {
    const state = await branchState(SITE_BRANCH);
    if (!state) throw new Error("repository update failed");
    for (const entry of state.files) {
      if (!entry.path.startsWith("published/")) continue;
      const rel = entry.path.slice("published/".length);
      if (!rel) continue;
      files.set(rel, await blobBytes(entry.sha));
    }
  } else {
    for (const rel of await listLocal("site", "published/")) {
      const short = rel.slice("published/".length);
      const bytes = await readLocal("site", rel);
      if (bytes) files.set(short, bytes);
    }
  }
  if (!files.has("live.json")) files.set("live.json", jsonBytes({ kind: "coming-soon" }));
  return files;
}

async function writeSite(files, message) {
  if (useGitHub()) {
    const state = await branchState(SITE_BRANCH);
    if (!state) throw new Error("repository update failed");
    const keep = new Set();
    const writes = [];
    for (const [rel, bytes] of files) {
      const path = `published/${rel}`;
      keep.add(path);
      writes.push({ path, bytes });
    }
    const deletes = state.files
      .map((file) => file.path)
      .filter((path) => path.startsWith("published/") && !keep.has(path));
    await commitBranch(SITE_BRANCH, writes, deletes, message);
    return;
  }
  const existing = await listLocal("site", "published/");
  const keep = new Set();
  for (const [rel, bytes] of files) {
    keep.add(`published/${rel}`);
    await writeLocal("site", `published/${rel}`, bytes);
  }
  for (const rel of existing) {
    if (!keep.has(rel)) await removeLocal("site", rel);
  }
}

async function readPrevious() {
  if (useGitHub()) {
    const state = await branchState(DRAFT_BRANCH);
    if (!state?.files.some((file) => file.path === "previous/present.json")) return null;
    const files = new Map();
    for (const entry of state.files) {
      if (!entry.path.startsWith("previous/published/")) continue;
      files.set(entry.path.slice("previous/published/".length), await blobBytes(entry.sha));
    }
    return files;
  }
  if (!await readLocal("drafts", "previous/present.json")) return null;
  const files = new Map();
  for (const rel of await listLocal("drafts", "previous/published/")) {
    const bytes = await readLocal("drafts", rel);
    if (bytes) files.set(rel.slice("previous/published/".length), bytes);
  }
  return files;
}

async function writePrevious(files) {
  const writes = [{ path: "previous/present.json", bytes: jsonBytes({ present: true }) }];
  const keep = new Set(["previous/present.json"]);
  for (const [rel, bytes] of files) {
    const path = `previous/published/${rel}`;
    keep.add(path);
    writes.push({ path, bytes });
  }
  if (useGitHub()) {
    const state = await branchState(DRAFT_BRANCH);
    const deletes = (state?.files || [])
      .map((file) => file.path)
      .filter((path) => path.startsWith("previous/") && !keep.has(path));
    await commitBranch(DRAFT_BRANCH, writes, deletes, "Store the previous public version");
    return;
  }
  const existing = await listLocal("drafts", "previous/");
  for (const file of writes) await writeLocal("drafts", file.path, file.bytes);
  for (const rel of existing) {
    if (!keep.has(rel)) await removeLocal("drafts", rel);
  }
}

function siteFromDraft(projects) {
  return (async () => {
    const files = new Map();
    files.set("live.json", jsonBytes({ kind: "site" }));
    files.set("projects.json", jsonBytes(projects.map(publicRecord)));
    for (const project of projects) {
      for (const which of ["before", "after"]) {
        if (!project[which]) continue;
        const rel = `media/${project.id}/${which}.${extension(project[which])}`;
        const bytes = await readDraftBytes(rel);
        if (!bytes) throw new Error("repository update failed");
        files.set(rel, bytes);
      }
    }
    return files;
  })();
}

export function saveDraft(input) {
  return locked(() => saveDraftUnlocked(input));
}

export function deleteDraft(id) {
  return locked(() => deleteDraftUnlocked(id));
}

export function readDraft(id) {
  return locked(() => readDraftUnlocked(id));
}

export function listDrafts() {
  return locked(() => listDraftsUnlocked());
}

export function draftImage(id, which) {
  return locked(() => draftImageUnlocked(id, which));
}

export function hasPrevious() {
  return locked(async () => Boolean(await readPrevious()));
}

export function liveStatus() {
  return locked(async () => ({ kind: await liveKind() }));
}

export function publishedProjects() {
  return locked(async () => {
    const projects = await publishedList();
    return projects.map((project) => ({
      id: project.id,
      title: project.title,
      notes: project.notes,
      recommendations: project.recommendations,
      before: Boolean(publishedPath(project, "before")),
      after: Boolean(publishedPath(project, "after")),
      updatedAt: project.updatedAt,
    }));
  });
}

export function publishedImage(id, which) {
  return locked(async () => {
    if (!UUID.test(id) || (which !== "before" && which !== "after")) return null;
    if (await liveKind() !== "site") return null;
    const project = (await publishedList()).find((item) => item.id === id);
    const path = publishedPath(project, which);
    if (!path) return null;
    const bytes = await siteBytes(path.slice("published/".length));
    if (!bytes) return null;
    const type = EXTENSION_TYPE[path.split(".").pop()] || "";
    if (!type) return null;
    return { image: bytes, type };
  });
}

export function publishDraft() {
  return locked(async () => {
    const projects = await loadProjects();
    const previous = await currentSiteFiles();
    await writePrevious(previous);
    await writeSite(await siteFromDraft(projects), "Publish the Shaw Gardens site");
  });
}

export function revertLive() {
  return locked(async () => {
    const previous = await readPrevious();
    if (!previous) return false;
    const current = await currentSiteFiles();
    await writeSite(previous, "Revert the Shaw Gardens site");
    await writePrevious(current);
    return true;
  });
}
