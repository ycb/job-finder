import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeShortlistFile } from "../src/shortlist/render.js";

test("writeShortlistFile writes shortlist payload and returns output path", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-shortlist-"));
  const outputPath = path.join(tempDir, "shortlist.json");

  try {
    const returnedPath = writeShortlistFile(
      [{ id: "1", title: "AI PM", company: "Acme" }],
      { outputPath }
    );

    assert.equal(returnedPath, path.resolve(outputPath));
    const payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(payload.total, 1);
    assert.ok(Array.isArray(payload.jobs));
    assert.equal(payload.jobs[0].title, "AI PM");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
