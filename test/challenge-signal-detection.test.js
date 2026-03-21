import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  classifyRefreshErrorOutcome,
  readRefreshState,
  recordRefreshEvent,
  resolveSourceRefreshState
} from "../src/sources/refresh-state.js";

test("classifyRefreshErrorOutcome detects challenge/captcha style failures", () => {
  assert.equal(
    classifyRefreshErrorOutcome(new Error("Looks like automated queries. Verify you're human.")),
    "challenge"
  );
  assert.equal(
    classifyRefreshErrorOutcome(new Error("Cloudflare: additional verification needed before continuing.")),
    "challenge"
  );
  assert.equal(
    classifyRefreshErrorOutcome("Request blocked by bot protection / captcha required"),
    "challenge"
  );
  assert.equal(
    classifyRefreshErrorOutcome(new Error("Could not extract jobs from the active Chrome tab.")),
    "transient_error"
  );
});

test("challenge outcome sets cooldown in refresh state", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-challenge-state-"));
  const statePath = path.join(tempDir, "refresh-state.json");

  try {
    recordRefreshEvent({
      statePath,
      sourceId: "google-ai",
      outcome: "challenge",
      at: "2026-03-06T10:00:00.000Z",
      cooldownMinutes: 180
    });

    const state = readRefreshState(statePath);
    const sourceState = resolveSourceRefreshState(state, "google-ai");

    assert.equal(sourceState.cooldownUntil, "2026-03-06T13:00:00.000Z");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
