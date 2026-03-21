import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readSourceCaptureSummary } from "../src/sources/cache-policy.js";
import {
  collectYcJobsFromSearch,
  writeYcCaptureFile
} from "../src/sources/yc-jobs.js";

function createTempCapturePath(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    tempDir,
    capturePath: path.join(tempDir, "capture.json")
  };
}

test("writeYcCaptureFile persists expectedCount and company-page review targets", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-yc-expected-");
  const source = {
    id: "yc-product-jobs",
    name: "YC Jobs",
    type: "yc_jobs",
    searchUrl: "https://www.workatastartup.com/jobs/l/product-manager",
    capturePath
  };

  try {
    const writeResult = writeYcCaptureFile(
      source,
      [
        {
          externalId: "101",
          title: "Founding Product Manager",
          company: "Metriport",
          location: "San Francisco, CA",
          employmentType: "Full-time",
          easyApply: false,
          salaryText: null,
          summary: "Healthcare infrastructure APIs",
          description: "Healthcare infrastructure APIs",
          url: "https://www.workatastartup.com/companies/metriport"
        }
      ],
      {
        expectedCount: 1,
        pageUrl: source.searchUrl
      }
    );

    const summary = readSourceCaptureSummary(source);
    assert.equal(summary.status, "ready");
    assert.equal(summary.expectedCount, 1);
    assert.equal(summary.payload?.expectedCount, 1);
    assert.equal(summary.payload?.jobs[0]?.url, "https://www.workatastartup.com/companies/metriport");
    assert.equal(writeResult.expectedCount, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("collectYcJobsFromSearch fetches, filters, writes capture metadata, and respects maxJobs", () => {
  const { tempDir, capturePath } = createTempCapturePath("job-finder-yc-collect-");
  const source = {
    id: "yc-product-jobs",
    name: "YC Jobs",
    type: "yc_jobs",
    searchUrl: "https://www.workatastartup.com/jobs/l/product-manager",
    capturePath,
    maxJobs: 1
  };
  const html = `
    <html>
      <body>
        <div
          data-page="{&quot;component&quot;:&quot;JobsPage&quot;,&quot;props&quot;:{&quot;jobs&quot;:[{&quot;id&quot;:101,&quot;title&quot;:&quot;Founding Product Manager&quot;,&quot;companyName&quot;:&quot;Metriport&quot;,&quot;companySlug&quot;:&quot;metriport&quot;,&quot;location&quot;:&quot;San Francisco, CA&quot;,&quot;jobType&quot;:&quot;Full-time&quot;,&quot;roleType&quot;:&quot;Product&quot;,&quot;companyBatch&quot;:&quot;W23&quot;,&quot;companyOneLiner&quot;:&quot;Healthcare infrastructure APIs&quot;,&quot;applyUrl&quot;:&quot;https://account.ycombinator.com/authenticate?signup_job_id=101&quot;},{&quot;id&quot;:102,&quot;title&quot;:&quot;Product Designer&quot;,&quot;companyName&quot;:&quot;DesignCo&quot;,&quot;companySlug&quot;:&quot;designco&quot;,&quot;location&quot;:&quot;Remote&quot;,&quot;jobType&quot;:&quot;Full-time&quot;,&quot;roleType&quot;:&quot;Design&quot;,&quot;companyBatch&quot;:&quot;S22&quot;,&quot;companyOneLiner&quot;:&quot;Design tools&quot;,&quot;applyUrl&quot;:&quot;https://account.ycombinator.com/authenticate?signup_job_id=102&quot;}]}}"
        ></div>
      </body>
    </html>
  `;

  try {
    const jobs = collectYcJobsFromSearch(source, {
      fetchHtml() {
        return html;
      }
    });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "101");
    assert.ok(typeof jobs[0].retrievedAt === "string" && jobs[0].retrievedAt.length > 0);

    const summary = readSourceCaptureSummary(source);
    assert.equal(summary.status, "ready");
    assert.equal(summary.jobCount, 1);
    assert.equal(summary.expectedCount, 1);
    assert.equal(summary.payload?.captureFunnel?.capturedRawCount, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
