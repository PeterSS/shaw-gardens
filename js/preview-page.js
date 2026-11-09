const api = "https://shaw-gardens.apps.grok.bot";
const list = document.getElementById("documented-list");
const status = document.getElementById("preview-status");
const signIn = document.getElementById("sign-in");
const revert = document.getElementById("revert-live");

function paragraph(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

async function picture(id, which, version) {
  const response = await fetch(`${api}/draft/media/${encodeURIComponent(id)}/${which}?v=${encodeURIComponent(version)}`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  const blob = await response.blob();
  const fig = document.createElement("figure");
  const img = document.createElement("img");
  img.src = URL.createObjectURL(blob);
  img.alt = which === "before" ? "Before" : "After";
  const cap = document.createElement("figcaption");
  cap.textContent = img.alt;
  fig.append(img, cap);
  return fig;
}

async function showProjects(projects) {
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
      if (project.before) {
        const fig = await picture(project.id, "before", version);
        if (fig) pair.append(fig);
      }
      if (project.after) {
        const fig = await picture(project.id, "after", version);
        if (fig) pair.append(fig);
      }
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

async function load() {
  let payload;
  try {
    const response = await fetch(`${api}/api/draft`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (response.status === 401) {
      signIn.hidden = false;
      return;
    }
    if (!response.ok) return;
    payload = await response.json();
  } catch {
    return;
  }
  signIn.hidden = true;
  revert.hidden = !payload.previous;
  await showProjects(payload.projects);
}

async function act(path, confirmText, notice) {
  if (!window.confirm(confirmText)) return;
  let response;
  try {
    response = await fetch(`${api}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
  } catch {
    status.textContent = "The preview could not update the public site.";
    return;
  }
  if (response.status === 401) {
    signIn.hidden = false;
    status.textContent = "Sign in before changing the public site.";
    return;
  }
  if (!response.ok) {
    status.textContent = "The preview could not update the public site.";
    return;
  }
  status.textContent = notice;
  await load();
}

document.getElementById("publish-live").addEventListener("click", () => {
  act("/api/publish", "Publish this preview on the public site?", "The public site now shows this version.");
});
revert.addEventListener("click", () => {
  act("/api/revert", "Put the previous public version back?", "The public site is back on the previous version.");
});
load();
