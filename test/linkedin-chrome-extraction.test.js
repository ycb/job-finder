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
    url: "https://www.linkedin.com/jobs/view/4388130875/"
  });

  assert.equal(
    sanitized.description,
    "About the job Replicant is hiring a Principal Product Manager to lead conversational AI platform strategy. You will own roadmap prioritization, partner with engineering, and define product bets for enterprise customers."
  );
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
