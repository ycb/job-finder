import assert from "node:assert/strict";
import test from "node:test";

import { formatHttpLink, formatLocalDocLink } from "../src/cli/ui/links.js";

test("formatLocalDocLink renders label and link/fallback target", () => {
  process.env.JOB_FINDER_FORCE_OSC8 = "1";
  const rendered = formatLocalDocLink("TERMS.md", "TERMS.md");
  delete process.env.JOB_FINDER_FORCE_OSC8;
  assert.equal(rendered.includes("TERMS.md"), true);
  assert.equal(rendered.includes("\u001B]8;;"), true);
});

test("formatHttpLink renders label and link/fallback target", () => {
  process.env.JOB_FINDER_FORCE_OSC8 = "1";
  const rendered = formatHttpLink("Dashboard", "http://127.0.0.1:4311");
  delete process.env.JOB_FINDER_FORCE_OSC8;
  assert.equal(rendered.includes("Dashboard"), true);
  assert.equal(rendered.includes("\u001B]8;;"), true);
});

test("formatHttpLink disables OSC8 on Apple Terminal by default", () => {
  process.env.TERM_PROGRAM = "Apple_Terminal";
  const rendered = formatHttpLink("Dashboard", "http://127.0.0.1:4311");
  delete process.env.TERM_PROGRAM;
  assert.equal(rendered.includes("\u001B]8;;"), false);
  assert.equal(rendered.includes("Dashboard"), true);
});
