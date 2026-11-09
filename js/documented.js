const list = document.getElementById("documented-list");
const liveOrigin = "https://shaw-gardens.apps.grok.bot";
const preview = document.body.dataset.preview === "true";

function projectBase() {
  if (preview) return "";
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

function mediaUrl(base, id, which, version) {
  const root = preview ? "/draft/media" : "/media";
  const path = `${root}/${encodeURIComponent(id)}/${which}?v=${encodeURIComponent(version)}`;
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
      const version = project.updatedAt || "";
      if (project.before) pair.append(figure(mediaUrl(base, project.id, "before", version), "Before"));
      if (project.after) pair.append(figure(mediaUrl(base, project.id, "after", version), "After"));
      article.append(pair);
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

async function load() {
  if (!list) return;
  const base = projectBase();
  try {
    if (preview) {
      const projects = await fetchJson(join(base, "/api/draft"));
      if (projects) showProjects(projects, base);
      return;
    }
    const live = await fetchJson(join(base, "/api/live"));
    if (!live || live.kind !== "site") return;
    const soon = document.getElementById("coming-soon");
    const site = document.getElementById("site");
    if (soon) soon.hidden = true;
    if (site) site.hidden = false;
    const projects = await fetchJson(join(base, "/api/projects"));
    if (projects) showProjects(projects, base);
  } catch {
    return;
  }
}

load();
