import test from "node:test";
import assert from "node:assert/strict";

import { parseGoogleSearchHtml } from "../src/sources/google-jobs.js";

test("parseGoogleSearchHtml extracts external job links from Google SERP HTML", () => {
  const html = `
    <html>
      <body>
        <a href="/url?q=https%3A%2F%2Fwww.indeed.com%2Fviewjob%3Fjk%3Dabc123&sa=U">Senior Product Manager, AI</a>
        <div>Indeed · San Francisco · 2 days ago</div>
        <a href="/url?q=https%3A%2F%2Fwww.ziprecruiter.com%2Fjobs%2Fexample-company%2Fsenior-product-manager-ai-xyz&sa=U">Senior Product Manager AI</a>
        <div>ZipRecruiter · Remote</div>
        <a href="/search?q=not+a+job">Not a job</a>
      </body>
    </html>
  `;

  const jobs = parseGoogleSearchHtml(
    html,
    "https://www.google.com/search?q=ai+product+manager+san+francisco"
  );

  assert.equal(jobs.length, 2);
  assert.match(jobs[0].url, /indeed\.com/i);
  assert.match(jobs[1].url, /ziprecruiter\.com/i);
  assert.equal(Boolean(jobs[0].title), true);
});

