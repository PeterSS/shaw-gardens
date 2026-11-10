export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function shell(title, main) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>
  <link rel="icon" href="images/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <p class="wordmark"><a href="index.html#home">Shaw Gardens</a></p>
    <nav aria-label="On this page">
      <a href="index.html#home">Home</a>
      <a href="index.html#projects">Projects</a>
      <a href="index.html#about">About</a>
      <a href="index.html#contact">Contact</a>
    </nav>
  </header>
  <main>
    ${main}
  </main>
</body>
</html>`;
}

const previewPage = "https://www.shawgardens.nz/preview/";

export function loginPage(error, next) {
  const message = error === "unconfigured"
    ? "<p class=\"form-error\">Sign-in is not configured yet. Set the maintenance password on the server, then try again.</p>"
    : error === "limited"
      ? "<p class=\"form-error\">Too many tries. Wait a little, then try again.</p>"
      : error
        ? "<p class=\"form-error\">That password was not accepted.</p>"
        : "";
  const nextField = next === previewPage ? `<input type="hidden" name="next" value="${esc(previewPage)}">` : "";
  return shell("Maintain · Shaw Gardens", `
    <h1>Maintain</h1>
    <p>For Tom. Saved changes show on the GitHub Pages preview. Publish Live is on that page.</p>
    ${message}
    <form class="maintain" method="post" action="/maintain/login" autocomplete="off">
      ${nextField}
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
  `);
}

function pictureFields(prefix, suffix, hasPicture) {
  const field = `${prefix}-${suffix}`;
  const clear = hasPicture
    ? `<label class="check"><input name="remove_${prefix}" type="checkbox" value="1"> Remove the ${prefix} picture</label>`
    : "";
  return `
    <label for="${field}">${prefix === "before" ? "Before picture" : "After picture"}</label>
    <input id="${field}" name="${prefix}" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
    ${clear}
  `;
}

function projectForm(project) {
  const editing = Boolean(project);
  const title = editing ? esc(project.title) : "";
  const notes = editing ? esc(project.notes) : "";
  const recommendations = editing ? esc(project.recommendations) : "";
  const id = editing ? `<input type="hidden" name="id" value="${esc(project.id)}">` : "";
  return `
    <form class="maintain" method="post" action="/maintain/save" enctype="multipart/form-data">
      ${id}
      <label for="title-${editing ? esc(project.id) : "new"}">Title</label>
      <input id="title-${editing ? esc(project.id) : "new"}" name="title" type="text" maxlength="160" required value="${title}">
      <label for="notes-${editing ? esc(project.id) : "new"}">Project notes</label>
      <textarea id="notes-${editing ? esc(project.id) : "new"}" name="notes" maxlength="8000" rows="6">${notes}</textarea>
      <label for="recommendations-${editing ? esc(project.id) : "new"}">Recommendations</label>
      <textarea id="recommendations-${editing ? esc(project.id) : "new"}" name="recommendations" maxlength="8000" rows="4">${recommendations}</textarea>
      ${pictureFields("before", editing ? esc(project.id) : "new", editing && project.before)}
      ${pictureFields("after", editing ? esc(project.id) : "new", editing && project.after)}
      <button type="submit">${editing ? "Save changes" : "Add project"}</button>
    </form>
  `;
}

export function editorPage(projects, error, ready) {
  const message = error === "picture"
    ? "<p class=\"form-error\">Use a JPEG, PNG, WEBP, or GIF picture, up to 2 MB.</p>"
    : error === "title"
      ? "<p class=\"form-error\">A project needs a title.</p>"
      : error === "missing"
        ? "<p class=\"form-error\">That project is no longer there.</p>"
        : error === "store"
          ? "<p class=\"form-error\">The repository could not be updated. Try again once GH_TOKEN is set.</p>"
          : "";
  const repository = ready
    ? ""
    : "<p class=\"form-error\">Add the GH_TOKEN secret so drafts can be saved in the shaw-gardens repository.</p>";
  const items = projects.map((project) => `
    <article class="record">
      <h2>${esc(project.title)}</h2>
      ${projectForm(project)}
      <form method="post" action="/maintain/delete" onsubmit="return confirm('Remove this project?')">
        <input type="hidden" name="id" value="${esc(project.id)}">
        <button type="submit">Remove project</button>
      </form>
    </article>
  `).join("");
  return shell("Maintain · Shaw Gardens", `
    <h1>Maintain</h1>
    <p>Notes, recommendations, and pictures saved here are written to the draft in the shaw-gardens repository. The public site changes from Publish Live on the preview page.</p>
    <p><a href="https://www.shawgardens.nz/preview/">Open the preview</a></p>
    ${repository}
    ${message}
    <form method="post" action="/maintain/logout">
      <button type="submit">Sign out</button>
    </form>
    <h2>Add a project</h2>
    ${projectForm(null)}
    <h2>Saved projects</h2>
    ${items || "<p>No documented projects yet.</p>"}
  `);
}
