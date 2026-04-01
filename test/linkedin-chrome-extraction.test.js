import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  chooseLinkedInSalaryText,
  chooseLinkedInDescription,
  sanitizeLinkedInJob,
  sanitizeLinkedInTitle
} from "../src/sources/linkedin-cleanup.js";
import {
  collectRawJobsFromSource,
  collectLinkedInCaptureFile,
  collectJobsFromSource,
  parseLinkedInSnapshot,
  writeLinkedInCaptureFile
} from "../src/sources/linkedin-saved-search.js";
import {
  finalizeLinkedInCapturePayload,
  isLinkedInHydratedRowSnapshot
} from "../src/browser-bridge/providers/chrome-applescript.js";

test("sanitizeLinkedInTitle strips duplicated verification suffixes", () => {
  assert.equal(
    sanitizeLinkedInTitle("Principal Product Manager Principal Product Manager with verification"),
    "Principal Product Manager"
  );
});

test("sanitizeLinkedInTitle removes company/location noise from polluted card text", () => {
  assert.equal(
    sanitizeLinkedInTitle(
      "Principal Product Manager Principal Product Manager Replicant United States (Remote) 2 school alumni work here Posted on March 18, 2026, 8:24 AM 1 day ago",
      { company: "Replicant", location: "United States (Remote)" }
    ),
    "Principal Product Manager"
  );
});

test("chooseLinkedInSalaryText rejects implausible million-scale detail salary noise", () => {
  assert.equal(chooseLinkedInSalaryText("", "$60M"), null);
});

test("chooseLinkedInSalaryText accepts plausible detail salary ranges when card salary is absent", () => {
  assert.equal(
    chooseLinkedInSalaryText("", "$130,602.50 - $219,500.00"),
    "$130,602.50 - $219,500.00"
  );
});

test("sanitizeLinkedInJob cleans persisted polluted LinkedIn rows", () => {
  const sanitized = sanitizeLinkedInJob({
    sourceId: "linkedin-live-capture",
    source: "linkedin_capture_file",
    title:
      "Principal Product Manager Principal Product Manager Replicant United States (Remote) 2 school alumni work here Posted on March 18, 2026, 8:24 AM 1 day ago",
    company: "Principal Product Manager",
    location: "United States (Remote)",
    description:
      "Principal Product Manager · Replicant · United States (Remote) · Posted on March 18, 2026, 8:24 AM · $130,602.50 - $219,500.00",
    salaryText: "$60M"
  });

  assert.equal(sanitized.title, "Principal Product Manager");
  assert.equal(sanitized.company, "Replicant");
  assert.equal(sanitized.salaryText, null);
  assert.match(sanitized.description, /Replicant/);
  assert.doesNotMatch(sanitized.description, /Posted on/i);
});

test("sanitizeLinkedInJob canonicalizes LinkedIn direct urls and external ids", () => {
  const sanitized = sanitizeLinkedInJob({
    sourceId: "linkedin-live-capture",
    source: "linkedin_capture_file",
    title: "Product Manager Product Manager with verification",
    company: "Envoy",
    location: "San Francisco, CA",
    description: "Product Manager · Envoy · San Francisco, CA",
    externalId: "",
    url: "https://www.linkedin.com/jobs/view/4388130875/?trackingId=abc123"
  });

  assert.equal(sanitized.externalId, "4388130875");
  assert.equal(sanitized.url, "https://www.linkedin.com/jobs/view/4388130875/");
});

test("sanitizeLinkedInJob strips location suffixes from polluted LinkedIn company text", () => {
  const sanitized = sanitizeLinkedInJob({
    sourceId: "linkedin-live-capture",
    source: "linkedin_capture_file",
    title: "Vice President of AI and Analytics",
    company: "Enzo Tech Group · United States (Remote)",
    location: "United States",
    description: "Vice President of AI and Analytics · Enzo Tech Group · United States (Remote)",
    url: "https://www.linkedin.com/jobs/view/4388511040/"
  });

  assert.equal(sanitized.company, "Enzo Tech Group");
  assert.equal(sanitized.summary, "Vice President of AI and Analytics · Enzo Tech Group · United States");
});

test("sanitizeLinkedInJob drops numeric benefits residue from polluted descriptions", () => {
  const sanitized = sanitizeLinkedInJob({
    sourceId: "linkedin-live-capture",
    source: "linkedin_capture_file",
    title: "Head of Artificial Intelligence",
    company: "Confidential Company",
    location: "United States (Remote)",
    description:
      "Head of Artificial Intelligence · Confidential Company · United States (Remote) · 8 benefits · Posted on March 20, 2026, 5:27 AM · 9 hours ago",
    url: "https://www.linkedin.com/jobs/view/4388359455/"
  });

  assert.equal(
    sanitized.description,
    "Head of Artificial Intelligence · Confidential Company · United States (Remote)"
  );
});

test("chooseLinkedInDescription prefers narrative detail text over metadata summaries", () => {
  assert.equal(
    chooseLinkedInDescription({
      description:
        "Principal Product Manager · Replicant · United States (Remote) · Posted on March 18, 2026, 8:24 AM · $130,602.50 - $219,500.00",
      detailDescription:
        "About the job Replicant is hiring a Principal Product Manager to lead conversational AI platform strategy. You will own roadmap prioritization, partner with engineering, and define product bets for enterprise customers."
    }),
    "About the job Replicant is hiring a Principal Product Manager to lead conversational AI platform strategy. You will own roadmap prioritization, partner with engineering, and define product bets for enterprise customers."
  );
});

test("sanitizeLinkedInJob prefers detail-first descriptions when present", () => {
  const sanitized = sanitizeLinkedInJob({
    sourceId: "linkedin-live-capture",
    source: "linkedin_capture_file",
    title: "Principal Product Manager",
    company: "Replicant",
    location: "United States (Remote)",
    description:
      "Principal Product Manager · Replicant · United States (Remote) · Posted on March 18, 2026, 8:24 AM · $130,602.50 - $219,500.00",
    detailDescription:
      "About the job Replicant is hiring a Principal Product Manager to lead conversational AI platform strategy. You will own roadmap prioritization, partner with engineering, and define product bets for enterprise customers.",
    detailExternalId: "4388130875",
    externalId: "4388130875",
    url: "https://www.linkedin.com/jobs/view/4388130875/"
  });

  assert.equal(
    sanitized.description,
    "About the job Replicant is hiring a Principal Product Manager to lead conversational AI platform strategy. You will own roadmap prioritization, partner with engineering, and define product bets for enterprise customers."
  );
});

test("sanitizeLinkedInJob ignores detail descriptions without a matching detail id", () => {
  const sanitized = sanitizeLinkedInJob({
    sourceId: "linkedin-live-capture",
    source: "linkedin_capture_file",
    title: "Product Manager",
    company: "Peregrine",
    location: "San Francisco, CA",
    description: "Product Manager · Peregrine · San Francisco, CA",
    detailDescription:
      "About the job Meta Product Managers work with cross-functional teams of engineers, designers, data scientists and researchers to build products.",
    externalId: "111111111",
    url: "https://www.linkedin.com/jobs/view/111111111/"
  });

  assert.equal(sanitized.description, "Product Manager · Peregrine · San Francisco, CA");
});

test("sanitizeLinkedInJob drops mismatched LinkedIn detail descriptions", () => {
  const sanitized = sanitizeLinkedInJob({
    sourceId: "linkedin-live-capture",
    source: "linkedin_capture_file",
    title: "Product Manager",
    company: "Peregrine",
    location: "San Francisco, CA",
    description: "Product Manager · Peregrine · San Francisco, CA",
    detailDescription:
      "About the job Location: Seattle, WA/Remote; open to candidates anywhere in the U.S. Compensation: $200K-$300K+.",
    detailExternalId: "999999999",
    externalId: "111111111",
    url: "https://www.linkedin.com/jobs/view/111111111/"
  });

  assert.equal(
    sanitized.description,
    "Product Manager · Peregrine · San Francisco, CA"
  );
  assert.equal(sanitized.detailExternalId, "999999999");
});

test("isLinkedInHydratedRowSnapshot requires title and company for MVP capture", () => {
  assert.equal(
    isLinkedInHydratedRowSnapshot({
      externalId: "123",
      title: "Product Manager",
      company: "Replicant"
    }),
    true
  );
  assert.equal(
    isLinkedInHydratedRowSnapshot({
      externalId: "123",
      title: "",
      company: "Replicant"
    }),
    false
  );
  assert.equal(
    isLinkedInHydratedRowSnapshot({
      externalId: "123",
      title: "Product Manager",
      company: ""
    }),
    false
  );
});

test("finalizeLinkedInCapturePayload skips placeholder rows and records diagnostics", () => {
  const result = finalizeLinkedInCapturePayload({
    pageUrl: "https://www.linkedin.com/jobs/search/?keywords=Product%20manager%20ai",
    expectedCount: 49,
    pageCountVisited: 2,
    stopReason: "exhausted_page_rows",
    rowSnapshots: [
      {
        status: "hydrated",
        externalId: "4388130875",
        title: "Principal Product Manager",
        company: "Replicant",
        location: "United States (Remote)",
        directUrl: "https://www.linkedin.com/jobs/view/4388130875/",
        salaryText: "$130,602.50 - $219,500.00",
        postedAt: "1 day ago",
        summaryText: "Principal Product Manager · Replicant · United States (Remote)",
        descriptionText:
          "Principal Product Manager · Replicant · United States (Remote) · $130,602.50 - $219,500.00"
      },
      {
        status: "placeholder",
        externalId: "4388511040"
      }
    ]
  });

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].title, "Principal Product Manager");
  assert.equal(result.jobs[0].externalId, "4388130875");
  assert.deepEqual(result.captureDiagnostics.capturedJobIds, ["4388130875"]);
  assert.equal(result.captureDiagnostics.capturedCount, 1);
  assert.equal(result.captureDiagnostics.missedPlaceholderCount, 1);
  assert.deepEqual(result.captureDiagnostics.missedPlaceholderJobIds, ["4388511040"]);
  assert.equal(result.captureDiagnostics.pageCountVisited, 2);
  assert.equal(result.captureDiagnostics.stopReason, "exhausted_page_rows");
});

test("finalizeLinkedInCapturePayload counts mismatched detail ids and ignores their descriptions", () => {
  const result = finalizeLinkedInCapturePayload({
    pageUrl: "https://www.linkedin.com/jobs/search/?keywords=Product%20manager",
    expectedCount: 43,
    rowSnapshots: [
      {
        status: "hydrated",
        externalId: "111111111",
        title: "Product Manager",
        company: "Peregrine",
        location: "San Francisco, CA",
        directUrl: "https://www.linkedin.com/jobs/view/111111111/",
        descriptionText: "Product Manager · Peregrine · San Francisco, CA",
        detailExternalId: "999999999",
        detailDescription:
          "About the job Location: Seattle, WA/Remote; open to candidates anywhere in the U.S.",
        detailLocation: "Seattle, WA"
      }
    ]
  });

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].description, "Product Manager · Peregrine · San Francisco, CA");
  assert.equal(result.captureDiagnostics.detailMismatchCount, 1);
});

test("writeLinkedInCaptureFile sanitizes polluted LinkedIn jobs before persisting", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-linkedin-write-"));
  const source = {
    id: "linkedin-live-capture",
    name: "LinkedIn",
    type: "linkedin_capture_file",
    searchUrl: "https://www.linkedin.com/jobs/search-results/?keywords=product+manager",
    capturePath: path.join(tempDir, "linkedin.json")
  };

  writeLinkedInCaptureFile(source, [
    {
      title:
        "Principal Product Manager Principal Product Manager Replicant United States (Remote) 2 school alumni work here Posted on March 18, 2026, 8:24 AM 1 day ago",
      company: "Principal Product Manager",
      location: "United States (Remote)",
      description:
        "Principal Product Manager · Replicant · United States (Remote) · Posted on March 18, 2026, 8:24 AM · $130,602.50 - $219,500.00",
      salaryText: "$60M",
      url: "https://www.linkedin.com/jobs/view/4388130875/?trackingId=abc123",
      externalId: ""
    }
  ]);

  const payload = JSON.parse(fs.readFileSync(source.capturePath, "utf8"));
  assert.equal(payload.jobs[0].title, "Principal Product Manager");
  assert.equal(payload.jobs[0].company, "Replicant");
  assert.equal(payload.jobs[0].summary, "Principal Product Manager · Replicant · United States (Remote)");
  assert.equal(
    payload.jobs[0].description,
    "Principal Product Manager · Replicant · United States (Remote) · $130,602.50 - $219,500.00"
  );
  assert.equal(payload.jobs[0].url, "https://www.linkedin.com/jobs/view/4388130875/");
  assert.equal(payload.jobs[0].externalId, "4388130875");
});

test("collectLinkedInCaptureFile repairs polluted persisted LinkedIn rows on read", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-linkedin-read-"));
  const source = {
    id: "linkedin-live-capture",
    name: "LinkedIn",
    type: "linkedin_capture_file",
    capturePath: path.join(tempDir, "linkedin.json")
  };

  fs.writeFileSync(
    source.capturePath,
    `${JSON.stringify(
      {
        capturedAt: "2026-03-20T00:00:00.000Z",
        pageUrl: "https://www.linkedin.com/jobs/search-results/?keywords=product+manager",
        jobs: [
          {
            title:
              "Principal Product Manager Principal Product Manager Replicant United States (Remote) 2 school alumni work here Posted on March 18, 2026, 8:24 AM 1 day ago",
            company: "Principal Product Manager",
            location: "United States (Remote)",
            description:
              "Principal Product Manager · Replicant · United States (Remote) · Posted on March 18, 2026, 8:24 AM · $130,602.50 - $219,500.00",
            detailDescription:
              "About the job Meta Product Managers work with cross-functional teams of engineers, designers, data scientists and researchers to build products.",
            url: "https://www.linkedin.com/jobs/view/4388130875/?trackingId=abc123",
            externalId: ""
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const jobs = collectLinkedInCaptureFile(source);
  assert.equal(jobs[0].title, "Principal Product Manager");
  assert.equal(jobs[0].company, "Replicant");
  assert.equal(
    jobs[0].description,
    "Principal Product Manager · Replicant · United States (Remote) · $130,602.50 - $219,500.00"
  );
  assert.equal(jobs[0].url, "https://www.linkedin.com/jobs/view/4388130875/");
  assert.equal(jobs[0].externalId, "4388130875");
});

test("collectRawJobsFromSource preserves raw LinkedIn capture rows while collectJobsFromSource applies source hard filters", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-linkedin-raw-"));
  const source = {
    id: "linkedin-live-capture",
    name: "LinkedIn",
    type: "linkedin_capture_file",
    searchUrl: "https://www.linkedin.com/jobs/search/?keywords=product+manager+ai",
    capturePath: path.join(tempDir, "linkedin.json")
  };

  fs.writeFileSync(
    source.capturePath,
    `${JSON.stringify(
      {
        capturedAt: "2026-03-31T00:00:00.000Z",
        pageUrl: source.searchUrl,
        jobs: [
          {
            title: "Senior Product Manager",
            company: "Example",
            location: "San Francisco, CA",
            description: "Thin snippet without explicit AI mention",
            url: "https://www.linkedin.com/jobs/view/1/"
          },
          {
            title: "Engineering Manager",
            company: "Example",
            location: "San Francisco, CA",
            description: "AI infrastructure role",
            url: "https://www.linkedin.com/jobs/view/2/"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  assert.equal(collectRawJobsFromSource(source).length, 2);
  assert.equal(collectJobsFromSource(source).length, 1);
});

test("parseLinkedInSnapshot cleans duplicated LinkedIn titles in parsed jobs", () => {
  const jobs = parseLinkedInSnapshot(`
- button "Principal Product Manager Principal Product Manager with verification Dismiss Principal Product Manager job" [ref=a] [cursor=pointer]:
  - paragraph [ref=b]: Principal Product Manager Principal Product Manager with verification
  - paragraph [ref=c]: Replicant
  - paragraph [ref=d]: United States (Remote)
  - paragraph [ref=e]: Posted on March 18, 2026
`.trim());

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Principal Product Manager");
  assert.equal(jobs[0].company, "Replicant");
  assert.equal(
    jobs[0].url,
    "https://www.linkedin.com/jobs/search-results/?keywords=Principal+Product+Manager+Replicant"
  );
});

test("sanitizeLinkedInJob leaves non-LinkedIn jobs unchanged", () => {
  const job = {
    sourceId: "indeed-ai-pm",
    source: "indeed_search",
    title: "Product Manager",
    company: "Example",
    location: "Remote",
    description: "Product Manager role",
    salaryText: "$18/hr"
  };

  assert.deepEqual(sanitizeLinkedInJob(job), job);
});
