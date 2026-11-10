import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0xd9]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("draft files publish and revert without a database", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "shaw-store-"));
  process.env.STORE = "local";
  process.env.GH_TOKEN = "";
  process.env.STORE_ROOT = root;
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await import("../src/store.mjs");
  const id = "11111111-1111-4111-8111-111111111111";

  assert.equal(await store.repositoryReady(), false);
  assert.equal((await store.liveStatus()).kind, "coming-soon");
  assert.equal(await store.hasPrevious(), false);

  assert.equal(await store.saveDraft({
    creating: true,
    id,
    title: "Terrace",
    notes: "Cleared the steps",
    recommendations: "Keep the native ferns",
    before: { bytes: jpeg, type: "image/jpeg" },
    after: { bytes: png, type: "image/png" },
  }), true);

  const listed = await store.listDrafts();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, "Terrace");
  assert.equal(listed[0].before, true);
  const before = await readFile(join(root, "drafts", "media", id, "before.jpg"));
  assert.equal(before.equals(jpeg), true);
  const after = await readFile(join(root, "drafts", "media", id, "after.png"));
  assert.equal(after.equals(png), true);

  await store.publishDraft();
  assert.equal((await store.liveStatus()).kind, "site");
  assert.equal(await store.hasPrevious(), true);
  const live = JSON.parse(await readFile(join(root, "site", "published", "live.json"), "utf8"));
  assert.equal(live.kind, "site");
  const published = JSON.parse(await readFile(join(root, "site", "published", "projects.json"), "utf8"));
  assert.equal(published[0].before, `published/media/${id}/before.jpg`);
  const publicBefore = await store.publishedImage(id, "before");
  assert.equal(publicBefore.type, "image/jpeg");
  assert.equal(publicBefore.image.equals(jpeg), true);

  assert.equal(await store.revertLive(), true);
  assert.equal((await store.liveStatus()).kind, "coming-soon");
  assert.equal((await store.publishedProjects()).length, 0);
  await assert.rejects(readFile(join(root, "site", "published", "projects.json")));
  assert.equal((await store.listDrafts()).length, 1);

  assert.equal(await store.revertLive(), true);
  assert.equal((await store.liveStatus()).kind, "site");

  assert.equal(await store.deleteDraft(id), true);
  assert.equal((await store.listDrafts()).length, 0);
  await assert.rejects(readFile(join(root, "drafts", "media", id, "before.jpg")));
});
