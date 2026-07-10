import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import {
  ANSWER_KIND,
  ANSWER_TYPE,
  createAnswerStore,
  IDENTITY_QUESTION_KEYS
} from "../src/apply/answer-store.js";
import { validateFormSchema } from "../src/apply/form-schema.js";
import {
  demographicQuestionKey,
  isDemographicField,
  mapLabelToQuestionKey
} from "../src/apply/field-mapping.js";
import { buildDraftPlan } from "../src/apply/engine.js";

const FIXTURES_DIR = new URL("./fixtures/apply/", import.meta.url);

function loadFixture(name) {
  return JSON.parse(
    fs.readFileSync(new URL(name, FIXTURES_DIR), "utf8")
  );
}

function createSeededStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-apply-engine-"));
  const { db } = openDatabase(path.join(dir, "jobs.db"));
  runMigrations(db);
  const store = createAnswerStore(db);

  store.saveAnswer({ kind: ANSWER_KIND.IDENTITY, questionKey: IDENTITY_QUESTION_KEYS.FIRST_NAME, answerValue: "Peter", answerType: ANSWER_TYPE.TEXT });
  store.saveAnswer({ kind: ANSWER_KIND.IDENTITY, questionKey: IDENTITY_QUESTION_KEYS.LAST_NAME, answerValue: "Spannagle", answerType: ANSWER_TYPE.TEXT });
  store.saveAnswer({ kind: ANSWER_KIND.IDENTITY, questionKey: IDENTITY_QUESTION_KEYS.EMAIL, answerValue: "peter.spannagle@gmail.com", answerType: ANSWER_TYPE.TEXT });
  store.saveAnswer({ kind: ANSWER_KIND.IDENTITY, questionKey: IDENTITY_QUESTION_KEYS.PHONE, answerValue: "555-0100", answerType: ANSWER_TYPE.TEXT });
  store.saveAnswer({ kind: ANSWER_KIND.LINK, questionKey: IDENTITY_QUESTION_KEYS.LINKEDIN_URL, answerValue: "https://www.linkedin.com/in/example", answerType: ANSWER_TYPE.URL });
  store.saveAnswer({ kind: ANSWER_KIND.DOCUMENT, questionKey: IDENTITY_QUESTION_KEYS.RESUME_PATH, answerValue: "/Users/admin/resume.pdf", answerType: ANSWER_TYPE.FILE_PATH });
  store.saveAnswer({
    kind: ANSWER_KIND.SCREENER,
    questionKey: IDENTITY_QUESTION_KEYS.WORK_AUTHORIZATION_US,
    questionText: "Are you authorized to work in the United States?",
    answerValue: "true",
    answerType: ANSWER_TYPE.BOOLEAN
  });
  store.saveAnswer({
    kind: ANSWER_KIND.SCREENER,
    questionKey: IDENTITY_QUESTION_KEYS.REQUIRES_SPONSORSHIP,
    questionText: "Will you now or in the future require sponsorship for employment visa status?",
    answerValue: "false",
    answerType: ANSWER_TYPE.BOOLEAN
  });

  return { db, dir, store };
}

function cleanup(db, dir) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

test("both fixtures validate against the form-schema contract", () => {
  validateFormSchema(loadFixture("greenhouse-gitlab-schema.json"));
  validateFormSchema(loadFixture("linkedin-easy-apply-schema.json"));
});

test("validateFormSchema rejects malformed schemas", () => {
  assert.throws(() => validateFormSchema({}), /requires a url/);
  assert.throws(
    () => validateFormSchema({ url: "x", adapter: "a", fields: [] }),
    /non-empty fields/
  );
  assert.throws(
    () =>
      validateFormSchema({
        url: "x",
        adapter: "a",
        fields: [
          { fieldId: "f", label: "L", type: "hologram", required: true }
        ]
      }),
    /unsupported type/
  );
  assert.throws(
    () =>
      validateFormSchema({
        url: "x",
        adapter: "a",
        fields: [
          { fieldId: "f", label: "A", type: "text", required: true },
          { fieldId: "f", label: "B", type: "text", required: true }
        ]
      }),
    /duplicates fieldId/
  );
});

test("field mapping canonicalizes standard ATS labels", () => {
  assert.equal(mapLabelToQuestionKey("First Name*"), "identity.first_name");
  assert.equal(mapLabelToQuestionKey("Resume/CV"), "document.resume");
  assert.equal(mapLabelToQuestionKey("LinkedIn Profile"), "link.linkedin");
  assert.equal(mapLabelToQuestionKey("Mobile Number"), "identity.phone");
  assert.equal(mapLabelToQuestionKey("Tell us about a project"), null);
});

test("demographic detection catches EEO fields by label and section", () => {
  assert.equal(isDemographicField({ label: "Gender" }), true);
  assert.equal(isDemographicField({ label: "Are you Hispanic/Latino?" }), true);
  assert.equal(isDemographicField({ label: "Veteran Status" }), true);
  assert.equal(isDemographicField({ label: "Disability Status" }), true);
  assert.equal(
    isDemographicField({
      label: "Anything else?",
      sectionLabel: "Voluntary Self-Identification"
    }),
    true
  );
  assert.equal(isDemographicField({ label: "First Name" }), false);
});

test("greenhouse fixture: engine fills standard fields, skips EEO, reports gaps", () => {
  const { db, dir, store } = createSeededStore();

  try {
    const schema = loadFixture("greenhouse-gitlab-schema.json");
    const { plan, unanswered, skipped } = buildDraftPlan({
      formSchema: schema,
      answerStore: store,
      job: { id: "job-gh-1" }
    });

    const byField = new Map(plan.map((entry) => [entry.fieldId, entry]));

    // Standard identity fields resolve exactly.
    assert.equal(byField.get("first_name").proposedValue, "Peter");
    assert.equal(byField.get("last_name").proposedValue, "Spannagle");
    assert.equal(byField.get("email").proposedValue, "peter.spannagle@gmail.com");
    assert.equal(byField.get("phone").proposedValue, "555-0100");
    assert.equal(byField.get("resume").proposedValue, "/Users/admin/resume.pdf");
    assert.equal(
      byField.get("question_linkedin").proposedValue,
      "https://www.linkedin.com/in/example"
    );
    for (const fieldId of ["first_name", "last_name", "email", "phone", "resume"]) {
      assert.equal(byField.get(fieldId).confidence, "exact");
    }

    // GitLab's sponsorship rewording ("...visa to remain in your current
    // location") scores 0.667 against the saved canonical phrasing — below
    // the 0.75 no-guess threshold. Conservative-by-design: it routes to the
    // user once, gets saved with this wording, and matches on every future
    // Greenhouse form that uses it. Assert it is unanswered, NOT guessed.
    assert.ok(
      !byField.has("question_sponsorship"),
      "near-miss screener must not be auto-filled"
    );

    // All four EEO fields skipped, never guessed.
    const skippedIds = skipped.map((entry) => entry.fieldId).sort();
    assert.deepEqual(skippedIds, [
      "eeo_disability",
      "eeo_gender",
      "eeo_hispanic",
      "eeo_veteran"
    ]);
    for (const entry of skipped) {
      assert.equal(entry.reason, "demographic");
    }

    // Company-specific questions the library can't answer are reported, not guessed.
    const unansweredIds = new Set(unanswered.map((entry) => entry.fieldId));
    assert.ok(unansweredIds.has("question_sponsorship"));
    assert.ok(unansweredIds.has("question_gitlab_username"));
    assert.ok(unansweredIds.has("question_previously_worked"));
    assert.ok(unansweredIds.has("question_country_residence"));

    // Coverage bar: >= 90% of the 7 standard fields (identity + docs + links).
    const standardFieldIds = [
      "first_name",
      "last_name",
      "email",
      "phone",
      "resume",
      "cover_letter",
      "question_linkedin"
    ];
    const covered = standardFieldIds.filter((id) => byField.has(id)).length;
    assert.ok(
      covered / standardFieldIds.length >= 0.85,
      `standard-field coverage too low: ${covered}/${standardFieldIds.length}`
    );
  } finally {
    cleanup(db, dir);
  }
});

test("easy-apply fixture: multistep markers ignored, radios coerced from booleans", () => {
  const { db, dir, store } = createSeededStore();

  try {
    const schema = loadFixture("linkedin-easy-apply-schema.json");
    const { plan, unanswered, skipped } = buildDraftPlan({
      formSchema: schema,
      answerStore: store,
      job: { id: "job-li-1" }
    });

    const planIds = plan.map((entry) => entry.fieldId);
    assert.ok(!planIds.some((id) => id.startsWith("step_")), "markers leaked into plan");
    assert.equal(skipped.length, 0);

    const byField = new Map(plan.map((entry) => [entry.fieldId, entry]));
    assert.equal(byField.get("q_work_auth").proposedValue, "Yes");
    assert.equal(byField.get("q_sponsorship").proposedValue, "No");
    assert.equal(byField.get("phone_number").proposedValue, "555-0100");
    assert.equal(byField.get("resume_upload").proposedValue, "/Users/admin/resume.pdf");

    // Experience/salary questions unanswered (salary saved? not in this seed) — never guessed.
    const unansweredIds = new Set(unanswered.map((entry) => entry.fieldId));
    assert.ok(unansweredIds.has("q_years_pm"));
    assert.ok(unansweredIds.has("q_salary"));
  } finally {
    cleanup(db, dir);
  }
});

test("select fields refuse answers that match no option", () => {
  const { db, dir, store } = createSeededStore();

  try {
    store.saveAnswer({
      kind: ANSWER_KIND.SCREENER,
      questionKey: "screener.favorite_office",
      questionText: "Which office would you like to work from?",
      answerValue: "Mars Station",
      answerType: ANSWER_TYPE.TEXT
    });

    const { plan, unanswered } = buildDraftPlan({
      formSchema: {
        url: "https://example.com/apply",
        adapter: "greenhouse",
        fields: [
          {
            fieldId: "office",
            label: "Which office would you like to work from?",
            type: "select",
            required: true,
            options: [
              { value: "sf", label: "San Francisco" },
              { value: "nyc", label: "New York" }
            ],
            sectionLabel: null
          }
        ]
      },
      answerStore: store
    });

    assert.equal(plan.length, 0);
    assert.equal(unanswered.length, 1);
    assert.equal(unanswered[0].fieldId, "office");
  } finally {
    cleanup(db, dir);
  }
});

test("explicitly saved demographic.* answers are honored, exact-only", () => {
  const { db, dir, store } = createSeededStore();

  try {
    store.saveAnswer({
      kind: ANSWER_KIND.FREEFORM,
      questionKey: demographicQuestionKey("Veteran Status"),
      questionText: "Veteran Status",
      answerValue: "I am not a protected veteran",
      answerType: ANSWER_TYPE.TEXT
    });

    const schema = loadFixture("greenhouse-gitlab-schema.json");
    const { plan, skipped } = buildDraftPlan({
      formSchema: schema,
      answerStore: store
    });

    const veteran = plan.find((entry) => entry.fieldId === "eeo_veteran");
    assert.ok(veteran, "explicit demographic answer should be used");
    assert.equal(veteran.proposedValue, "I am not a protected veteran");

    // The other EEO fields remain skipped.
    const skippedIds = skipped.map((entry) => entry.fieldId);
    assert.ok(skippedIds.includes("eeo_gender"));
    assert.ok(!skippedIds.includes("eeo_veteran"));
  } finally {
    cleanup(db, dir);
  }
});

test("engine stays transport-agnostic: no browser-bridge or review imports", () => {
  const srcDir = new URL("../src/apply/", import.meta.url);
  for (const file of ["engine.js", "form-schema.js", "field-mapping.js", "answer-store.js"]) {
    const source = fs.readFileSync(new URL(file, srcDir), "utf8");
    assert.ok(
      !/from\s+["'].*browser-bridge/.test(source),
      `${file} imports browser-bridge`
    );
    assert.ok(!/from\s+["'].*review\//.test(source), `${file} imports review`);
  }
});
