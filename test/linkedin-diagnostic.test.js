import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLinkedInDiagnosticSummary,
  extractLinkedInJobIdsFromResourceNames
} from "../src/sources/linkedin-diagnostic.js";

test("buildLinkedInDiagnosticSummary classifies visible, structured, and activation-recovered rows", () => {
  const summary = buildLinkedInDiagnosticSummary({
    rowSnapshots: [
      { rowId: "101", title: "Hydrated PM", company: "A" },
      { rowId: "102", title: "", company: "" },
      { rowId: "103", title: "", company: "" },
      { rowId: "104", title: "Visible only", company: "B" }
    ],
    structuredJobIds: ["101", "102", "999"],
    resourceJobIds: ["101", "102", "103", "888"],
    activationResults: [
      {
        rowId: "102",
        currentJobId: "102",
        selectedJobMatched: true,
        hydratedAfterActivation: true
      },
      {
        rowId: "103",
        currentJobId: "555",
        selectedJobMatched: false,
        hydratedAfterActivation: false
      }
    ]
  });

  assert.equal(summary.rowIdCount, 4);
  assert.equal(summary.hydratedVisibleRowCount, 2);
  assert.equal(summary.structuredCount, 3);
  assert.equal(summary.resourceJobCount, 4);
  assert.deepEqual(summary.missingFromStructured, ["103", "104"]);
  assert.deepEqual(summary.structuredOnly, ["999"]);
  assert.deepEqual(summary.resourceOnly, ["888"]);
  assert.deepEqual(summary.recoveredByActivation, ["102"]);
  assert.deepEqual(summary.unresolved, ["103", "104"]);
});

test("extractLinkedInJobIdsFromResourceNames pulls ids from prefetch and detail URLs", () => {
  const ids = extractLinkedInJobIdsFromResourceNames([
    "https://www.linkedin.com/voyager/api/graphql?...prefetchJobPostingCardUrns:List(urn%3Ali%3Afsd_jobPostingCard%3A%284362113094%2CJOB_DETAILS%29,urn%3Ali%3Afsd_jobPostingCard%3A%284324040699%2CJOB_DETAILS%29)",
    "https://www.linkedin.com/voyager/api/graphql?variables=(jobPostingUrn:urn%3Ali%3Afsd_jobPosting%3A4362113094)"
  ]);

  assert.deepEqual(ids, ["4362113094", "4324040699"]);
});
