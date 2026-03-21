import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  countSourceEventsForUtcDay,
  ensureRefreshStateFile,
  readRefreshState,
  recordRefreshEvent,
  resolveSourceRefreshState
} from "../src/sources/refresh-state.js";

function createTempStatePath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-refresh-state-"));
  return {
    tempDir,
    statePath: path.join(tempDir, "refresh-state.json")
  };
}

test("ensureRefreshStateFile initializes missing file with empty state", () => {
  const { tempDir, statePath } = createTempStatePath();

  try {
    assert.equal(fs.existsSync(statePath), false);
    const state = ensureRefreshStateFile(statePath);
    assert.equal(fs.existsSync(statePath), true);
    assert.equal(state.version, 1);
    assert.deepEqual(state.sources, {});
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("recordRefreshEvent stores source events and updates lastLiveAt", () => {
  const { tempDir, statePath } = createTempStatePath();

  try {
    recordRefreshEvent({
      statePath,
      sourceId: "google-ai",
      outcome: "success",
      at: "2026-03-06T10:00:00.000Z"
    });

    const sourceState = resolveSourceRefreshState(readRefreshState(statePath), "google-ai");
    assert.equal(sourceState.lastLiveAt, "2026-03-06T10:00:00.000Z");
    assert.equal(sourceState.lastAttemptedAt, "2026-03-06T10:00:00.000Z");
    assert.equal(sourceState.lastAttemptOutcome, "success");
    assert.equal(sourceState.lastError, null);
    assert.equal(sourceState.events.length, 1);
    assert.equal(sourceState.events[0].outcome, "success");
    assert.equal(sourceState.events[0].mode, "scheduled");
    assert.equal(sourceState.events[0].error, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("countSourceEventsForUtcDay returns only events for requested UTC day", () => {
  const { tempDir, statePath } = createTempStatePath();

  try {
    recordRefreshEvent({
      statePath,
      sourceId: "google-ai",
      outcome: "success",
      at: "2026-03-06T10:00:00.000Z"
    });
    recordRefreshEvent({
      statePath,
      sourceId: "google-ai",
      outcome: "transient_error",
      at: "2026-03-06T16:00:00.000Z"
    });
    recordRefreshEvent({
      statePath,
      sourceId: "google-ai",
      outcome: "success",
      at: "2026-03-07T01:00:00.000Z"
    });

    const state = readRefreshState(statePath);
    assert.equal(
      countSourceEventsForUtcDay(state, "google-ai", "2026-03-06T23:00:00.000Z"),
      2
    );
    assert.equal(
      countSourceEventsForUtcDay(state, "google-ai", "2026-03-07T12:00:00.000Z"),
      1
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("countSourceEventsForUtcDay can filter by refresh mode", () => {
  const { tempDir, statePath } = createTempStatePath();

  try {
    recordRefreshEvent({
      statePath,
      sourceId: "google-ai",
      outcome: "success",
      mode: "manual",
      at: "2026-03-06T10:00:00.000Z"
    });
    recordRefreshEvent({
      statePath,
      sourceId: "google-ai",
      outcome: "success",
      mode: "scheduled",
      at: "2026-03-06T12:00:00.000Z"
    });

    const state = readRefreshState(statePath);
    assert.equal(
      countSourceEventsForUtcDay(state, "google-ai", "2026-03-06T23:00:00.000Z", {
        mode: "manual"
      }),
      1
    );
    assert.equal(
      countSourceEventsForUtcDay(state, "google-ai", "2026-03-06T23:00:00.000Z", {
        mode: "scheduled"
      }),
      1
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("recordRefreshEvent enforces cooldown when challenge outcome is recorded", () => {
  const { tempDir, statePath } = createTempStatePath();

  try {
    recordRefreshEvent({
      statePath,
      sourceId: "google-ai",
      outcome: "challenge",
      at: "2026-03-06T10:00:00.000Z",
      cooldownMinutes: 120
    });

    const sourceState = resolveSourceRefreshState(readRefreshState(statePath), "google-ai");
    assert.equal(sourceState.events.length, 1);
    assert.equal(sourceState.events[0].outcome, "challenge");
    assert.equal(sourceState.events[0].mode, "scheduled");
    assert.equal(sourceState.lastAttemptOutcome, "challenge");
    assert.equal(sourceState.cooldownUntil, "2026-03-06T12:00:00.000Z");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("recordRefreshEvent preserves latest failed attempt metadata", () => {
  const { tempDir, statePath } = createTempStatePath();

  try {
    recordRefreshEvent({
      statePath,
      sourceId: "indeed-ai",
      outcome: "transient_error",
      at: "2026-03-06T10:00:00.000Z",
      error: "Cloudflare: additional verification needed"
    });

    const sourceState = resolveSourceRefreshState(readRefreshState(statePath), "indeed-ai");
    assert.equal(sourceState.lastAttemptedAt, "2026-03-06T10:00:00.000Z");
    assert.equal(sourceState.lastAttemptOutcome, "transient_error");
    assert.equal(sourceState.lastError, "Cloudflare: additional verification needed");
    assert.equal(sourceState.events[0].error, "Cloudflare: additional verification needed");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
