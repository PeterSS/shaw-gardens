const list = document.getElementById("documented-list");
const liveOrigin = "https://shaw-gardens.apps.grok.bot";

function projectBase() {
  const host = location.hostname;
  if (host === "shaw-gardens.apps.grok.bot" || host === "127.0.0.1" || host === "localhost") return "";
  return liveOrigin;
}

function join(base, path) {
  return `${base}${path}`;
}

function paragraph(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

function figure(src, caption) {
  const fig = document.createElement("figure");
  const img = document.createElement("img");
  img.src = src;
  img.alt = caption;
  const cap = document.createElement("figcaption");
  cap.textContent = caption;
  fig.append(img, cap);
  return fig;
}

function imageSrc(value, project, which, base) {
  const id = String(project.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return "";
  if (typeof value === "string" && new RegExp(`^published/media/${id}/${which}\\.(jpg|png|gif|webp)$`).test(value)) {
    return `${value}?v=${encodeURIComponent(project.updatedAt || "")}`;
  }
  if (value === true) return mediaUrl(base, project.id, which, project.updatedAt || "");
  return "";
}

function mediaUrl(base, id, which, version) {
  const path = `/media/${encodeURIComponent(id)}/${which}?v=${encodeURIComponent(version)}`;
  return join(base, path);
}

function showProjects(projects, base) {
  list.replaceChildren();
  if (!Array.isArray(projects) || projects.length === 0) {
    list.append(paragraph("No projects yet."));
    return;
  }
  for (const project of projects) {
    const article = document.createElement("article");
    article.className = "record";
    const heading = document.createElement("h3");
    heading.textContent = project.title || "Project";
    article.append(heading);
    if (project.notes) article.append(paragraph(project.notes));
    if (project.before || project.after) {
      const pair = document.createElement("div");
      pair.className = "pair";
      const before = imageSrc(project.before, project, "before", base);
      const after = imageSrc(project.after, project, "after", base);
      if (before) pair.append(figure(before, "Before"));
      if (after) pair.append(figure(after, "After"));
      if (pair.childElementCount) article.append(pair);
    }
    if (project.recommendations) {
      const label = document.createElement("h4");
      label.textContent = "Recommendations";
      article.append(label, paragraph(project.recommendations));
    }
    list.append(article);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  return response.json();
}

function showSite(projects, base) {
  const soon = document.getElementById("coming-soon");
  const site = document.getElementById("site");
  if (soon) soon.hidden = true;
  if (site) site.hidden = false;
  showProjects(Array.isArray(projects) ? projects : [], base);
}

async function load() {
  if (!list) return;
  try {
    const live = await fetchJson("published/live.json");
    if (live) {
      if (live.kind !== "site") return;
      const projects = await fetchJson("published/projects.json");
      showSite(projects, "");
      return;
    }
  } catch {
    return;
  }
  const base = projectBase();
  try {
    const live = await fetchJson(join(base, "/api/live"));
    if (!live || live.kind !== "site") return;
    const projects = await fetchJson(join(base, "/api/projects"));
    showSite(projects, base);
  } catch {
    return;
  }
}

load();
