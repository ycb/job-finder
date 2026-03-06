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
    assert.equal(sourceState.events.length, 1);
    assert.equal(sourceState.events[0].outcome, "success");
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
    assert.equal(sourceState.cooldownUntil, "2026-03-06T12:00:00.000Z");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
