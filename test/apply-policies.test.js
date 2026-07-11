import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { createAnswerStore } from "../src/apply/answer-store.js";
import { buildDraftPlan } from "../src/apply/engine.js";
import {
  DECLINE_TO_STATE_PATTERNS,
  SALARY_DEFAULT_OTHER,
  SALARY_DEFAULT_SF,
  parseTopOfSalaryRange,
  pickOptionByPreference
} from "../src/apply/answer-policies.js";

function createTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-apply-policies-"));
  const { db } = openDatabase(path.join(dir, "jobs.db"));
  runMigrations(db);
  return { dir, db, store: createAnswerStore(db) };
}

function cleanup(dir, db) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function schemaWith(fields) {
  return { url: "https://example.test/apply", adapter: "test", fields };
}

const declineOptions = [
  { value: "1", label: "Male" },
  { value: "2", label: "Female" },
  { value: "3", label: "Decline To Self Identify" }
];

test("pickOptionByPreference finds decline-style options across label variants", () => {
  for (const label of [
    "Decline To Self Identify",
    "I don't wish to answer",
    "Prefer not to say",
    "Decline to state"
  ]) {
    const picked = pickOptionByPreference(
      [{ value: "x", label: "Yes" }, { value: "y", label }],
      DECLINE_TO_STATE_PATTERNS
    );
    assert.equal(picked, label);
  }
});

test("parseTopOfSalaryRange handles common formats", () => {
  assert.equal(parseTopOfSalaryRange("$150,000 - $180,000 USD"), 180000);
  assert.equal(parseTopOfSalaryRange("150k–180k"), 180000);
  assert.equal(parseTopOfSalaryRange("$185,000/yr"), 185000);
  assert.equal(parseTopOfSalaryRange("Competitive"), null);
  assert.equal(parseTopOfSalaryRange(""), null);
  assert.equal(parseTopOfSalaryRange(null), null);
});

test("required demographic select gets the decline option via policy", () => {
  const { dir, db, store } = createTempStore();
  try {
    const { plan, skipped, unanswered } = buildDraftPlan({
      formSchema: schemaWith([
        {
          fieldId: "gender",
          label: "Gender",
          type: "select",
          required: true,
          options: declineOptions,
          sectionLabel: "Voluntary Self-Identification"
        }
      ]),
      answerStore: store
    });

    assert.equal(plan.length, 1);
    assert.equal(plan[0].proposedValue, "Decline To Self Identify");
    assert.equal(plan[0].source, "policy");
    assert.equal(plan[0].policyId, "demographic.decline_when_required");
    assert.equal(skipped.length, 0);
    assert.equal(unanswered.length, 0);
  } finally {
    cleanup(dir, db);
  }
});

test("optional demographic fields are still skipped, not declined", () => {
  const { dir, db, store } = createTempStore();
  try {
    const { plan, skipped } = buildDraftPlan({
      formSchema: schemaWith([
        {
          fieldId: "gender",
          label: "Gender",
          type: "select",
          required: false,
          options: declineOptions,
          sectionLabel: "Voluntary Self-Identification"
        }
      ]),
      answerStore: store
    });

    assert.equal(plan.length, 0);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].reason, "demographic");
  } finally {
    cleanup(dir, db);
  }
});

test("required demographic without a decline option routes to the user", () => {
  const { dir, db, store } = createTempStore();
  try {
    const { plan, unanswered } = buildDraftPlan({
      formSchema: schemaWith([
        {
          fieldId: "gender",
          label: "Gender",
          type: "select",
          required: true,
          options: [
            { value: "1", label: "Male" },
            { value: "2", label: "Female" }
          ],
          sectionLabel: "Voluntary Self-Identification"
        }
      ]),
      answerStore: store
    });

    assert.equal(plan.length, 0);
    assert.equal(unanswered.length, 1);
    assert.match(unanswered[0].note, /no decline option/i);
  } finally {
    cleanup(dir, db);
  }
});

test("salary free-text defaults to Let's discuss; library answer outranks it", () => {
  const { dir, db, store } = createTempStore();
  try {
    const salaryField = {
      fieldId: "salary",
      label: "What are your salary expectations?",
      type: "text",
      required: true,
      options: null,
      sectionLabel: null
    };

    const withoutLibrary = buildDraftPlan({
      formSchema: schemaWith([salaryField]),
      answerStore: store
    });
    assert.equal(withoutLibrary.plan[0].proposedValue, "Let's discuss");
    assert.equal(withoutLibrary.plan[0].source, "policy");
    assert.equal(withoutLibrary.plan[0].policyId, "salary.lets_discuss");

    store.saveAnswer({
      kind: "screener",
      questionKey: "screener.salary_expectation",
      questionText: "What are your salary expectations?",
      answerValue: "$210,000",
      answerType: "text"
    });

    const withLibrary = buildDraftPlan({
      formSchema: schemaWith([salaryField]),
      answerStore: store
    });
    assert.equal(withLibrary.plan[0].proposedValue, "$210,000");
    assert.equal(withLibrary.plan[0].source, "library");
  } finally {
    cleanup(dir, db);
  }
});

test("numeric salary uses top of the job's listed range", () => {
  const { dir, db, store } = createTempStore();
  try {
    const { plan } = buildDraftPlan({
      formSchema: schemaWith([
        {
          fieldId: "salary",
          label: "Desired salary",
          type: "number",
          required: true,
          options: null,
          sectionLabel: null
        }
      ]),
      answerStore: store,
      job: { id: "j1", salary_text: "$160,000 - $190,000", location: "New York, NY" }
    });

    assert.equal(plan[0].proposedValue, "190000");
    assert.equal(plan[0].policyId, "salary.top_of_listed_range");
  } finally {
    cleanup(dir, db);
  }
});

test("numeric salary without a range uses location-based defaults", () => {
  const { dir, db, store } = createTempStore();
  try {
    const numericField = {
      fieldId: "salary",
      label: "Desired salary",
      type: "number",
      required: true,
      options: null,
      sectionLabel: null
    };

    const sf = buildDraftPlan({
      formSchema: schemaWith([numericField]),
      answerStore: store,
      job: { id: "j1", salary_text: "Competitive", location: "San Francisco, CA" }
    });
    assert.equal(sf.plan[0].proposedValue, String(SALARY_DEFAULT_SF));
    assert.equal(sf.plan[0].policyId, "salary.default_sf");

    const remote = buildDraftPlan({
      formSchema: schemaWith([numericField]),
      answerStore: store,
      job: { id: "j2", salary_text: null, location: "Remote (US)" }
    });
    assert.equal(remote.plan[0].proposedValue, String(SALARY_DEFAULT_OTHER));
    assert.equal(remote.plan[0].policyId, "salary.default_other");
  } finally {
    cleanup(dir, db);
  }
});

test("portfolio/website fields fall back to the saved GitHub URL", () => {
  const { dir, db, store } = createTempStore();
  try {
    store.saveAnswer({
      kind: "link",
      questionKey: "link.github",
      answerValue: "https://github.com/pspannagle",
      answerType: "url"
    });

    const { plan } = buildDraftPlan({
      formSchema: schemaWith([
        {
          fieldId: "portfolio",
          label: "Portfolio",
          type: "text",
          required: false,
          options: null,
          sectionLabel: null
        }
      ]),
      answerStore: store
    });

    assert.equal(plan.length, 1);
    assert.equal(plan[0].proposedValue, "https://github.com/pspannagle");
    assert.equal(plan[0].questionKey, "link.github");
    assert.equal(plan[0].confidence, "fallback");
  } finally {
    cleanup(dir, db);
  }
});

test("github fields map directly to link.github", () => {
  const { dir, db, store } = createTempStore();
  try {
    store.saveAnswer({
      kind: "link",
      questionKey: "link.github",
      answerValue: "https://github.com/pspannagle",
      answerType: "url"
    });

    const { plan } = buildDraftPlan({
      formSchema: schemaWith([
        {
          fieldId: "gh",
          label: "GitHub Profile",
          type: "text",
          required: false,
          options: null,
          sectionLabel: null
        }
      ]),
      answerStore: store
    });

    assert.equal(plan.length, 1);
    assert.equal(plan[0].confidence, "exact");
  } finally {
    cleanup(dir, db);
  }
});

test("select options match saved answers by conservative containment", () => {
  const { dir, db, store } = createTempStore();
  try {
    store.saveAnswer({
      kind: "screener",
      questionKey: "screener.country_of_residence",
      questionText: "What is your current country of residence?",
      answerValue: "United States",
      answerType: "text"
    });

    const { plan } = buildDraftPlan({
      formSchema: schemaWith([
        {
          fieldId: "country",
          label: "What is your current country of residence?",
          type: "select",
          required: true,
          options: [
            { value: "ca", label: "Canada" },
            { value: "us", label: "United States of America" },
            { value: "uk", label: "United Kingdom" }
          ],
          sectionLabel: null
        }
      ]),
      answerStore: store
    });

    assert.equal(plan.length, 1);
    assert.equal(plan[0].proposedValue, "United States of America");
  } finally {
    cleanup(dir, db);
  }
});

test("ambiguous containment does not match (no guessing between options)", () => {
  const { dir, db, store } = createTempStore();
  try {
    store.saveAnswer({
      kind: "screener",
      questionKey: "screener.office_preference",
      questionText: "Preferred office",
      answerValue: "San Francisco",
      answerType: "text"
    });

    const { plan, unanswered } = buildDraftPlan({
      formSchema: schemaWith([
        {
          fieldId: "office",
          label: "Preferred office",
          type: "select",
          required: true,
          options: [
            { value: "1", label: "San Francisco — Mission" },
            { value: "2", label: "San Francisco — SOMA" }
          ],
          sectionLabel: null
        }
      ]),
      answerStore: store
    });

    assert.equal(plan.length, 0);
    assert.equal(unanswered.length, 1);
  } finally {
    cleanup(dir, db);
  }
});
