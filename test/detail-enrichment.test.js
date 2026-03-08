import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichJobsWithDetailPages,
  parseDetailHintsFromText,
  parseJobPostingFromHtml
} from "../src/sources/detail-enrichment.js";

test("parseJobPostingFromHtml extracts core fields from JSON-LD job posting", () => {
  const html = `
  <html><head>
    <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"JobPosting",
        "datePosted":"2026-03-01",
        "employmentType":"FULL_TIME",
        "baseSalary":{
          "@type":"MonetaryAmount",
          "value":{"@type":"QuantitativeValue","minValue":210000,"maxValue":260000,"unitText":"YEAR"}
        },
        "jobLocation":{
          "@type":"Place",
          "address":{"@type":"PostalAddress","addressLocality":"San Francisco","addressRegion":"CA","addressCountry":"US"}
        },
        "description":"<p>Lead AI platform product strategy</p>"
      }
    </script>
  </head></html>
  `;

  const parsed = parseJobPostingFromHtml(html);
  assert.equal(parsed.postedAt, "2026-03-01");
  assert.equal(parsed.employmentType, "FULL_TIME");
  assert.equal(parsed.salaryText, "$210,000 - $260,000 YEAR");
  assert.equal(parsed.location, "San Francisco, CA, US");
  assert.equal(parsed.description, "Lead AI platform product strategy");
});

test("parseDetailHintsFromText extracts fallback regex fields", () => {
  const parsed = parseDetailHintsFromText(
    "Posted 3 days ago. Compensation $180K - $220K annually. Full-time. Remote."
  );

  assert.equal(parsed.postedAt, "3 days ago");
  assert.equal(parsed.salaryText, "$180K - $220K annually");
  assert.equal(parsed.employmentType.toLowerCase(), "full-time");
  assert.equal(parsed.location.toLowerCase(), "remote");
});

test("enrichJobsWithDetailPages fills missing fields and sets provenance", () => {
  const jobs = [
    {
      title: "Senior Product Manager",
      company: "Example Co",
      location: null,
      postedAt: null,
      salaryText: null,
      employmentType: null,
      description: "Card summary",
      url: "https://careers.example.com/jobs/123"
    }
  ];

  const enriched = enrichJobsWithDetailPages("google_search", jobs, {
    maxJobs: 1,
    fetchHtml: () => `
      <script type="application/ld+json">
        {
          "@context":"https://schema.org",
          "@type":"JobPosting",
          "datePosted":"2026-03-05",
          "employmentType":"CONTRACT",
          "baseSalary":"$200,000 - $240,000",
          "jobLocation":{"@type":"Place","address":{"addressLocality":"New York","addressRegion":"NY"}},
          "description":"Own AI roadmap and delivery"
        }
      </script>
    `
  });

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].postedAt, "2026-03-05");
  assert.equal(enriched[0].employmentType, "CONTRACT");
  assert.equal(enriched[0].salaryText, "$200,000 - $240,000");
  assert.equal(enriched[0].location, "New York, NY");
  assert.equal(enriched[0].extractorProvenance.postedAt, "detail");
  assert.equal(enriched[0].extractorProvenance.salaryText, "detail");
  assert.equal(enriched[0].extractorProvenance.employmentType, "detail");
  assert.equal(enriched[0].extractorProvenance.location, "detail");
});
