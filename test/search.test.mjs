import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const robots = readFileSync(new URL("../robots.txt", import.meta.url), "utf8");
const sitemap = readFileSync(new URL("../sitemap.xml", import.meta.url), "utf8");

test("the public page names the business, the place, and the work", () => {
  assert.match(index, /<title>Shaw Gardens \| Garden maintenance in Wellington<\/title>/);
  assert.match(index, /rel="canonical" href="https:\/\/www\.shawgardens\.nz\/"/);
  assert.match(index, /"@type": "LandscapeService"/);
  assert.match(index, /Garden maintenance, landscaping, lawncare, topiary, and design/);
  assert.match(index, /<h1 class="wordmark">Shaw Gardens<\/h1>/);
  assert.match(index, /href="tel:\+642108378589"/);
});

test("crawlers are sent to the public page and kept out of the private ones", () => {
  assert.match(robots, /Sitemap: https:\/\/www\.shawgardens\.nz\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/preview/);
  assert.match(robots, /Disallow: \/maintain/);
  assert.match(sitemap, /<loc>https:\/\/www\.shawgardens\.nz\/<\/loc>/);
  for (const page of ["about.html", "contact.html", "projects.html"]) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /name="robots" content="noindex"/);
    assert.match(html, /rel="canonical" href="https:\/\/www\.shawgardens\.nz\//);
  }
});
