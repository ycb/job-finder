import test from "node:test";
import assert from "node:assert/strict";

import { validateSources } from "../src/config/schema.js";

test("validateSources accepts wellfound and ashby source types", () => {
  const parsed = validateSources({
    sources: [
      {
        id: "wf-ai",
        name: "Wellfound AI",
        type: "wellfound_search",
        enabled: true,
        searchUrl: "https://wellfound.com/jobs",
        maxJobs: 30
      },
      {
        id: "ashby-pm",
        name: "Ashby PM",
        type: "ashby_search",
        enabled: true,
        searchUrl: "https://jobs.ashbyhq.com/company",
        maxJobs: 40
      }
    ]
  });

  assert.equal(parsed.sources.length, 2);
  assert.equal(parsed.sources[0].type, "wellfound_search");
  assert.equal(parsed.sources[1].type, "ashby_search");
});
