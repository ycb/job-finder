import assert from "node:assert/strict";
import test from "node:test";

import { renderDashboardPage } from "../src/review/server.js";

test("renderDashboardPage uses capture message for single source run feedback", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("payload.capture && payload.capture.message"), true);
});

test("renderDashboardPage reports live vs cached counts after run-all", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("live source(s)"), true);
  assert.equal(html.includes("cached source(s)"), true);
});

test("renderDashboardPage includes adapter health indicator copy", () => {
  const html = renderDashboardPage({});
  assert.equal(html.includes("adapter degraded"), true);
  assert.equal(html.includes("adapter failing"), true);
});
