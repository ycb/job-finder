import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { captureSourceFromCli } from "../src/cli/capture-source.js";

function createTempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-cli-"));
  const filePath = path.join(dir, "snapshot.md");
  fs.writeFileSync(filePath, "snapshot", "utf8");
  return { dir, filePath };
}

test("captureSourceFromCli runs adapter collection for non-linkedin sources", () => {
  const source = { id: "levels", name: "Levels.fyi", type: "levelsfyi_search" };
  let opened = null;
  const result = captureSourceFromCli({
    source,
    snapshotPath: "/tmp/does-not-matter.md",
    openUrlInBrowser: (url) => {
      opened = url;
    },
    importLinkedInSnapshot: () => {
      throw new Error("should not be called");
    },
    collectRawJobsFromSource: () => [{ id: "job-1" }, { id: "job-2" }]
  });

  assert.equal(result.status, "captured");
  assert.equal(result.jobsImported, 2);
  assert.equal(opened, null);
});

test("captureSourceFromCli opens browser for missing linkedin snapshot", () => {
  const source = { id: "linkedin", name: "LinkedIn", type: "linkedin_capture_file", searchUrl: "https://example.test" };
  let opened = null;
  const result = captureSourceFromCli({
    source,
    snapshotPath: "/tmp/does-not-exist.md",
    openUrlInBrowser: (url) => {
      opened = url;
    },
    importLinkedInSnapshot: () => {
      throw new Error("should not be called");
    },
    collectRawJobsFromSource: () => {
      throw new Error("should not be called");
    }
  });

  assert.equal(result.status, "missing_snapshot");
  assert.equal(opened, source.searchUrl);
});

test("captureSourceFromCli imports linkedin snapshot when present", () => {
  const source = { id: "linkedin", name: "LinkedIn", type: "linkedin_capture_file", searchUrl: "https://example.test" };
  const { dir, filePath } = createTempFile();
  try {
    const result = captureSourceFromCli({
      source,
      snapshotPath: filePath,
      openUrlInBrowser: () => {
        throw new Error("should not be called");
      },
      importLinkedInSnapshot: () => ({ jobsImported: 12, capturePath: filePath }),
      collectRawJobsFromSource: () => {
        throw new Error("should not be called");
      }
    });

    assert.equal(result.status, "captured");
    assert.equal(result.jobsImported, 12);
    assert.equal(result.capturePath, filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
