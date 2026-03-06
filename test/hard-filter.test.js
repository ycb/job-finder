import test from "node:test";
import assert from "node:assert/strict";

import {
  applySourceHardFilters,
  jobMatchesRequiredTerms,
  resolveSourceRequiredTerms
} from "../src/sources/hard-filter.js";

test("resolveSourceRequiredTerms prefers explicit requiredTerms", () => {
  const source = {
    searchUrl: "https://www.linkedin.com/jobs/search-results/?keywords=principal+product+manager",
    requiredTerms: ["product manager", "ai"]
  };

  const terms = resolveSourceRequiredTerms(source);
  assert.deepEqual(terms, ["product manager", "ai"]);
});

test("resolveSourceRequiredTerms infers phrase + AI from search URL", () => {
  const source = {
    searchUrl:
      "https://www.linkedin.com/jobs/search-results/?keywords=ai%2Fml+product+manager"
  };

  const terms = resolveSourceRequiredTerms(source);
  assert.equal(terms.includes("product manager"), true);
  assert.equal(terms.includes("ai"), true);
});

test("resolveSourceRequiredTerms falls back to source name when URL has no query intent", () => {
  const source = {
    name: "AI Product Manager Jobs",
    searchUrl: "https://wellfound.com/jobs"
  };

  const terms = resolveSourceRequiredTerms(source);
  assert.equal(terms.includes("product manager"), true);
  assert.equal(terms.includes("ai"), true);
});

test("jobMatchesRequiredTerms requires all terms", () => {
  const terms = ["product manager", "ai"];
  assert.equal(
    jobMatchesRequiredTerms(
      {
        title: "Senior Product Manager, AI Platform",
        description: "Build AI products."
      },
      terms
    ),
    true
  );

  assert.equal(
    jobMatchesRequiredTerms(
      {
        title: "Senior Product Manager, Platform",
        description: "General platform role focused on analytics."
      },
      terms
    ),
    false
  );
});

test("applySourceHardFilters enforces title terms and defers content terms on snippets", () => {
  const source = {
    searchUrl: "https://www.linkedin.com/jobs/search-results/?keywords=product+manager+ai"
  };
  const jobs = [
    {
      title: "Senior Product Manager, AI",
      description: "AI workflows"
    },
    {
      title: "Senior Product Manager, Growth",
      description: "Growth experiments"
    }
  ];

  const result = applySourceHardFilters(source, jobs);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.droppedCount, 0);
  assert.equal(result.deferredContentChecks, 2);
});

test("applySourceHardFilters does not use URL text to satisfy title terms", () => {
  const source = {
    requiredTerms: ["product manager"]
  };
  const jobs = [
    {
      title: "Senior Platform Lead",
      description: "Platform leadership role.",
      url: "https://example.com/jobs/ai-product-manager"
    }
  ];

  const result = applySourceHardFilters(source, jobs);
  assert.equal(result.jobs.length, 0);
  assert.equal(result.droppedCount, 1);
});

test("applySourceHardFilters supports requiredAny and excludeAny", () => {
  const source = {
    requiredTerms: ["product manager"],
    hardFilter: {
      requiredAny: ["ai", "machine learning"],
      excludeAny: ["intern", "contract"]
    }
  };
  const jobs = [
    {
      title: "Senior Product Manager, AI Platform",
      description: "Full-time AI role"
    },
    {
      title: "Product Manager, Search",
      description:
        "Search relevance role with experimentation focus. Own roadmap, prioritization, and stakeholder alignment across PM, design, and engineering. This role focuses on search quality, experimentation systems, taxonomy, and retrieval methods for enterprise customers."
    },
    {
      title: "AI Product Manager Intern",
      description: "Internship"
    }
  ];

  const result = applySourceHardFilters(source, jobs);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.droppedCount, 2);
  assert.equal(result.jobs[0].title, "Senior Product Manager, AI Platform");
});

test("applySourceHardFilters defers content keyword checks on thin snippets", () => {
  const source = {
    requiredTerms: ["product manager", "ai"]
  };
  const jobs = [
    {
      title: "Senior Product Manager, Platform",
      description: "Own roadmap for platform capabilities."
    }
  ];

  const result = applySourceHardFilters(source, jobs);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.droppedCount, 0);
  assert.equal(result.deferredContentChecks, 1);
});
