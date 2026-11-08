const list = document.getElementById("documented-list");

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

async function load() {
  if (!list) return;
  let projects;
  try {
    const response = await fetch("api/projects", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    projects = await response.json();
  } catch {
    return;
  }
  list.replaceChildren();
  if (!Array.isArray(projects) || projects.length === 0) {
    list.append(paragraph("No documented projects yet."));
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
      const version = encodeURIComponent(project.updatedAt || "");
      if (project.before) pair.append(figure(`media/${encodeURIComponent(project.id)}/before?v=${version}`, "Before"));
      if (project.after) pair.append(figure(`media/${encodeURIComponent(project.id)}/after?v=${version}`, "After"));
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

load();
