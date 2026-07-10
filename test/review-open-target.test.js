import test from "node:test";
import assert from "node:assert/strict";

import { resolveJobOpenTarget } from "../src/review/server.js";

test("resolveJobOpenTarget returns unavailable when source URL is missing", () => {
  const result = resolveJobOpenTarget({
    id: "demo",
    source: "ziprecruiter_search",
    title: "Staff Product Manager, AI"
  });

  assert.equal(result.url, null);
  assert.equal(result.mode, "unavailable");
  assert.equal(result.reason, "missing_source_url");
});

test("resolveJobOpenTarget bypasses resolver for non-zip sources", () => {
  const result = resolveJobOpenTarget({
    id: "demo",
    source: "google_search",
    sourceUrl: "https://www.google.com/about/careers/applications/jobs/results/123",
    reviewTarget: {
      url: "https://www.google.com/about/careers/applications/jobs/results/123"
    },
    title: "Product Manager"
  });

  assert.equal(
    result.url,
    "https://www.google.com/about/careers/applications/jobs/results/123"
  );
  assert.equal(result.mode, "direct");
  assert.equal(result.reason, "no_resolution_needed");
  assert.equal(result.resolved, false);
});

test("resolveJobOpenTarget bypasses resolver when zip URL already has lk", () => {
  const result = resolveJobOpenTarget({
    id: "demo",
    source: "ziprecruiter_search",
    sourceUrl:
      "https://www.ziprecruiter.com/co/Oscar-Health/Jobs?uuid=zWV5P%2BW8znrUNHE5jjqOVjn7gw8%3D&lk=MvAc2c71ggWf0oX8zYla2g",
    reviewTarget: {
      url: "https://www.ziprecruiter.com/co/Oscar-Health/Jobs?uuid=zWV5P%2BW8znrUNHE5jjqOVjn7gw8%3D&lk=MvAc2c71ggWf0oX8zYla2g"
    },
    title: "Staff Product Manager, AI"
  });

  assert.equal(
    result.url,
    "https://www.ziprecruiter.com/co/Oscar-Health/Jobs?uuid=zWV5P%2BW8znrUNHE5jjqOVjn7gw8%3D&lk=MvAc2c71ggWf0oX8zYla2g"
  );
  assert.equal(result.mode, "direct");
  assert.equal(result.reason, "no_resolution_needed");
  assert.equal(result.resolved, false);
});
