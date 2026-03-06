import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeLinkedInCaptureFile } from "../src/sources/linkedin-saved-search.js";
import { readSourceCaptureSummary } from "../src/sources/cache-policy.js";

test("LinkedIn capture payload persists expectedCount for verification", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-li-expected-"));
  const capturePath = path.join(tempDir, "linkedin.json");

  const source = {
    id: "ai-pm",
    name: "AI PM",
    type: "linkedin_capture_file",
    searchUrl: "https://www.linkedin.com/jobs/search/?keywords=ai+product+manager",
    capturePath
  };

  try {
    writeLinkedInCaptureFile(
      source,
      [
        {
          externalId: "123",
          title: "Senior Product Manager",
          company: "Example",
          description: "desc",
          url: "https://www.linkedin.com/jobs/view/123/"
        }
      ],
      {
        expectedCount: 39,
        pageUrl: source.searchUrl
      }
    );

    const summary = readSourceCaptureSummary(source);
    assert.equal(summary.status, "ready");
    assert.equal(summary.jobCount, 1);
    assert.equal(summary.expectedCount, 39);
    assert.equal(summary.payload?.expectedCount, 39);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
