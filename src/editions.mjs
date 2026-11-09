import { randomUUID } from "node:crypto";
import { sql } from "./db.mjs";

export async function pointer() {
  const rows = await sql("select live_id, previous_id from site_pointer where id = 1");
  return rows[0] || { live_id: null, previous_id: null };
}

export async function liveStatus() {
  const rows = await sql(
    `select p.id, p.kind
     from site_pointer s
     join publications p on p.id = s.live_id
     where s.id = 1`,
  );
  return rows[0] || { id: null, kind: "coming-soon" };
}

function asProject(row) {
  return {
    id: row.project_id,
    title: row.title,
    notes: row.notes,
    recommendations: row.recommendations,
    before: Boolean(row.before),
    after: Boolean(row.after),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function publishedProjects() {
  const live = await liveStatus();
  if (live.kind !== "site") return [];
  const rows = await sql(
    `select project_id, title, notes, recommendations,
            before_type is not null as before,
            after_type is not null as after,
            updated_at
     from publication_projects
     where publication_id = $1
     order by position`,
    [live.id],
  );
  return rows.map(asProject);
}

export async function publishedImage(projectId, which) {
  const live = await liveStatus();
  if (live.kind !== "site") return null;
  const rows = which === "before"
    ? await sql(
      "select before_image as image, before_type as type from publication_projects where publication_id = $1 and project_id = $2",
      [live.id, projectId],
    )
    : await sql(
      "select after_image as image, after_type as type from publication_projects where publication_id = $1 and project_id = $2",
      [live.id, projectId],
    );
  return rows[0] || null;
}

export async function publishDraft() {
  const id = randomUUID();
  const current = await pointer();
  await sql("insert into publications (id, kind) values ($1, 'site')", [id]);
  await sql(
    `insert into publication_projects (
       publication_id, project_id, title, notes, recommendations,
       before_image, before_type, after_image, after_type, updated_at, position
     )
     select $1, id, title, notes, recommendations,
            before_image, before_type, after_image, after_type, updated_at,
            row_number() over (order by updated_at desc)
     from projects`,
    [id],
  );
  await sql(
    "update site_pointer set live_id = $1, previous_id = $2 where id = 1",
    [id, current.live_id],
  );
  await discard(current.previous_id, id, current.live_id);
}

export async function revertLive() {
  const current = await pointer();
  if (!current.previous_id) return false;
  await sql(
    "update site_pointer set live_id = $1, previous_id = $2 where id = 1",
    [current.previous_id, current.live_id],
  );
  return true;
}

async function discard(staleId, liveId, previousId) {
  if (!staleId || staleId === liveId || staleId === previousId) return;
  await sql("delete from publication_projects where publication_id = $1", [staleId]);
  await sql("delete from publications where id = $1", [staleId]);
}
