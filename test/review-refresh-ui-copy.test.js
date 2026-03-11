import assert from "node:assert/strict";
import test from "node:test";

import { renderDashboardPage } from "../src/review/server.js";

test("renderDashboardPage uses capture message for single source run feedback", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("payload.capture && payload.capture.message"), true);
});

test("renderDashboardPage reports simple run-all completion copy", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("sources. "), true);
  assert.equal(html.includes("active ranked jobs."), true);
  assert.equal(html.includes("live source(s)"), false);
  assert.equal(html.includes("cached source(s)"), false);
});

test("renderDashboardPage includes adapter health indicator copy", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("needs attention"), true);
});
