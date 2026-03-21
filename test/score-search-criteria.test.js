import test from "node:test";
import assert from "node:assert/strict";

import {
  buildScoringProfileFromSearchCriteria,
  evaluateJobsFromSearchCriteria
} from "../src/jobs/score.js";

test("buildScoringProfileFromSearchCriteria maps core criteria fields", () => {
  const profile = buildScoringProfileFromSearchCriteria({
    title: "product manager",
    keywords: "ai, platform",
    location: "San Francisco",
    minSalary: 200000
  });

  assert.deepEqual(profile.targetTitles, ["product manager"]);
  assert.deepEqual(profile.includeKeywords, ["ai", "platform"]);
  assert.deepEqual(profile.targetLocations, ["san francisco"]);
  assert.equal(profile.salaryFloor, 200000);
  assert.equal(profile.dealBreakers.salaryMinimum, 200000);
});

test("evaluateJobsFromSearchCriteria scores against search criteria instead of goals profile", () => {
  const criteria = {
    title: "product manager",
    keywords: "ai",
    location: "san francisco",
    minSalary: 200000
  };

  const evaluations = evaluateJobsFromSearchCriteria(criteria, [
    {
      id: "job-match",
      title: "Senior Product Manager, AI",
      company: "Acme",
      location: "San Francisco, CA",
      description: "AI platform growth role",
      salaryText: "$220,000 - $260,000",
      source: "indeed_search",
      postedAt: new Date().toISOString()
    },
    {
      id: "job-miss",
      title: "Senior Software Engineer",
      company: "Acme",
      location: "San Francisco, CA",
      description: "AI platform role",
      salaryText: "$220,000 - $260,000",
      source: "indeed_search",
      postedAt: new Date().toISOString()
    }
  ]);

  assert.equal(evaluations.length, 2);
  assert.equal(evaluations[0].jobId, "job-match");
  assert.equal(evaluations[1].jobId, "job-miss");
  assert.ok(evaluations[0].score > evaluations[1].score);
  assert.equal(evaluations[0].bucket, "high_signal");
  assert.equal(evaluations[1].bucket, "reject");
});

test("evaluateJobsFromSearchCriteria uses weighted criteria math", () => {
  const criteria = {
    title: "product manager",
    keywords: "ai",
    location: "san francisco",
    minSalary: 200000,
    datePosted: "1w"
  };

  const evaluations = evaluateJobsFromSearchCriteria(criteria, [
    {
      id: "job-partial",
      title: "Product Manager, AI Platform",
      company: "Example",
      location: "San Francisco, CA",
      description: "",
      salaryText: "",
      postedAt: ""
    }
  ]);

  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].jobId, "job-partial");
  assert.equal(evaluations[0].score, 75);
  assert.equal(evaluations[0].bucket, "high_signal");
});

test("evaluateJobsFromSearchCriteria falls back to baseline scoring when criteria are empty", () => {
  const evaluations = evaluateJobsFromSearchCriteria({}, [
    {
      id: "job-pm",
      title: "Senior Product Manager, AI",
      company: "Acme",
      location: "San Francisco, CA",
      description: "AI platform growth role",
      source: "indeed_search",
      postedAt: new Date().toISOString()
    },
    {
      id: "job-eng",
      title: "Senior Software Engineer",
      company: "Acme",
      location: "San Francisco, CA",
      description: "Infrastructure role",
      source: "indeed_search",
      postedAt: new Date().toISOString()
    }
  ]);

  assert.equal(evaluations.length, 2);
  assert.equal(evaluations[0].jobId, "job-pm");
  assert.equal(evaluations[1].jobId, "job-eng");
  assert.ok(evaluations[0].score > evaluations[1].score);
  assert.equal(evaluations[0].bucket, "review_later");
});

test("evaluateJobsFromSearchCriteria supports keyword OR mode", () => {
  const baseJob = {
    id: "job-partial-keyword-hit",
    title: "Senior Product Manager",
    company: "Acme",
    location: "San Francisco, CA",
    description: "Own AI platform roadmap",
    salaryText: "$220,000 - $260,000",
    source: "indeed_search",
    postedAt: new Date().toISOString()
  };

  const andEvaluation = evaluateJobsFromSearchCriteria(
    {
      keywords: "ai, fintech",
      keywordMode: "and"
    },
    [baseJob]
  )[0];

  const orEvaluation = evaluateJobsFromSearchCriteria(
    {
      keywords: "ai, fintech",
      keywordMode: "or"
    },
    [baseJob]
  )[0];

  assert.ok(orEvaluation.score > andEvaluation.score);
  assert.equal(orEvaluation.bucket, "high_signal");
});

test("evaluateJobsFromSearchCriteria applies exclude terms as hard filters", () => {
  const evaluations = evaluateJobsFromSearchCriteria(
    {
      title: "product manager",
      includeTerms: ["platform"],
      excludeTerms: ["contract"]
    },
    [
      {
        id: "job-blocked",
        title: "Product Manager (Contract)",
        company: "Acme",
        location: "San Francisco, CA",
        description: "AI platform contract role",
        salaryText: "$220,000 - $260,000",
        source: "indeed_search",
        postedAt: new Date().toISOString()
      }
    ]
  );

  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].bucket, "reject");
  assert.equal(evaluations[0].score, 0);
  assert.equal(evaluations[0].hardFiltered, true);
  assert.match(evaluations[0].summary, /hard filter hit/i);
});

test("evaluateJobsFromSearchCriteria applies semantic hard include matching for ai family terms", () => {
  const evaluations = evaluateJobsFromSearchCriteria(
    {
      title: "product manager",
      hardIncludeTerms: ["ai"]
    },
    [
      {
        id: "job-semantic-ai",
        title: "Senior Product Manager",
        company: "Acme",
        location: "San Francisco, CA",
        description: "Own the machine learning platform roadmap.",
        salaryText: "$220,000 - $260,000",
        source: "indeed_search",
        postedAt: new Date().toISOString()
      }
    ]
  );

  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].hardFiltered, false);
  assert.ok(evaluations[0].score > 0);
});

test("evaluateJobsFromSearchCriteria applies semantic hard exclude matching for ai family terms", () => {
  const evaluations = evaluateJobsFromSearchCriteria(
    {
      title: "product manager",
      hardExcludeTerms: ["ai"]
    },
    [
      {
        id: "job-semantic-ai-excluded",
        title: "Senior Product Manager",
        company: "Acme",
        location: "San Francisco, CA",
        description: "Own the machine learning platform roadmap.",
        salaryText: "$220,000 - $260,000",
        source: "indeed_search",
        postedAt: new Date().toISOString()
      }
    ]
  );

  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].hardFiltered, true);
  assert.equal(evaluations[0].score, 0);
  assert.match(evaluations[0].summary, /hard filter hit/i);
});

test("evaluateJobsFromSearchCriteria keeps baseline scoring for exclude-only criteria", () => {
  const evaluations = evaluateJobsFromSearchCriteria(
    {
      excludeTerms: ["contract"]
    },
    [
      {
        id: "job-excluded",
        title: "Product Manager (Contract)",
        company: "Acme",
        location: "San Francisco, CA",
        description: "Contract product role",
        salaryText: "$220,000 - $260,000",
        source: "indeed_search",
        postedAt: new Date().toISOString()
      },
      {
        id: "job-eligible",
        title: "Senior Product Manager",
        company: "Acme",
        location: "San Francisco, CA",
        description: "Own AI platform roadmap",
        salaryText: "$220,000 - $260,000",
        source: "indeed_search",
        postedAt: new Date().toISOString()
      }
    ]
  );

  const excluded = evaluations.find((evaluation) => evaluation.jobId === "job-excluded");
  const eligible = evaluations.find((evaluation) => evaluation.jobId === "job-eligible");

  assert.ok(excluded);
  assert.equal(excluded.hardFiltered, true);
  assert.equal(excluded.score, 0);

  assert.ok(eligible);
  assert.equal(eligible.hardFiltered, false);
  assert.ok(eligible.score > 0);
});

test("evaluateJobsFromSearchCriteria enforces hard include terms with AND default", () => {
  const evaluations = evaluateJobsFromSearchCriteria(
    {
      hardIncludeTerms: ["ai", "platform"]
    },
    [
      {
        id: "job-missing-required",
        title: "Senior Product Manager",
        company: "Acme",
        location: "San Francisco, CA",
        description: "Own growth roadmap",
        salaryText: "$220,000 - $260,000",
        source: "indeed_search",
        postedAt: new Date().toISOString()
      }
    ]
  );

  assert.equal(evaluations[0].hardFiltered, true);
  assert.equal(evaluations[0].score, 0);
  assert.match(evaluations[0].summary, /missing required terms/i);
});

test("evaluateJobsFromSearchCriteria uses scoreKeywords as ranking-only terms", () => {
  const evaluations = evaluateJobsFromSearchCriteria(
    {
      hardIncludeTerms: ["product manager"],
      scoreKeywords: ["ai", "fintech"],
      scoreKeywordMode: "or"
    },
    [
      {
        id: "job-partial-score-hit",
        title: "Senior Product Manager",
        company: "Acme",
        location: "San Francisco, CA",
        description: "Lead AI platform roadmap",
        salaryText: "$220,000 - $260,000",
        source: "indeed_search",
        postedAt: new Date().toISOString()
      }
    ]
  );

  assert.equal(evaluations[0].hardFiltered, false);
  assert.ok(evaluations[0].score > 0);
  assert.match(evaluations[0].summary, /OR mode/i);
});
