import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import {
  ANSWER_KIND,
  ANSWER_TYPE,
  createAnswerStore,
  FUZZY_MATCH_THRESHOLD,
  IDENTITY_QUESTION_KEYS,
  questionSimilarity
} from "../src/apply/answer-store.js";

function createTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-answer-store-"));
  const dbPath = path.join(dir, "jobs.db");
  const { db } = openDatabase(dbPath);
  runMigrations(db);
  return { db, dir, dbPath };
}

function cleanupTempDb(db, dir) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

test("saveAnswer + getAnswer roundtrip with approved default", () => {
  const { db, dir } = createTempDb();

  try {
    const store = createAnswerStore(db);
    const saved = store.saveAnswer({
      kind: ANSWER_KIND.IDENTITY,
      questionKey: IDENTITY_QUESTION_KEYS.FULL_NAME,
      answerValue: "Peter Spannagle",
      answerType: ANSWER_TYPE.TEXT
    });

    assert.equal(saved.approved, true);
    assert.equal(saved.usageCount, 0);
    assert.ok(saved.id.length >= 32, "expected UUID id");

    const fetched = store.getAnswer(IDENTITY_QUESTION_KEYS.FULL_NAME);
    assert.equal(fetched.answerValue, "Peter Spannagle");
    assert.equal(fetched.kind, "identity");
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("saveAnswer upserts by question_key instead of duplicating", () => {
  const { db, dir } = createTempDb();

  try {
    const store = createAnswerStore(db);
    store.saveAnswer({
      kind: ANSWER_KIND.IDENTITY,
      questionKey: "identity.phone",
      answerValue: "555-0100",
      answerType: ANSWER_TYPE.TEXT
    });
    store.saveAnswer({
      kind: ANSWER_KIND.IDENTITY,
      questionKey: "identity.phone",
      answerValue: "555-0199",
      answerType: ANSWER_TYPE.TEXT
    });

    const all = store.listAnswers();
    assert.equal(all.length, 1);
    assert.equal(all[0].answerValue, "555-0199");
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("unapproved answers are invisible to lookups (truth fidelity)", () => {
  const { db, dir } = createTempDb();

  try {
    const store = createAnswerStore(db);
    store.saveAnswer({
      kind: ANSWER_KIND.SCREENER,
      questionKey: "screener.notice_period",
      questionText: "What is your notice period?",
      answerValue: "Two weeks",
      answerType: ANSWER_TYPE.TEXT,
      approved: false
    });

    assert.equal(store.getAnswer("screener.notice_period"), null);
    assert.equal(
      store.findAnswerForField({ label: "What is your notice period?" }),
      null
    );
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("fuzzy screener matching finds rephrased work-authorization question", () => {
  const { db, dir } = createTempDb();

  try {
    const store = createAnswerStore(db);
    store.saveAnswer({
      kind: ANSWER_KIND.SCREENER,
      questionKey: IDENTITY_QUESTION_KEYS.WORK_AUTHORIZATION_US,
      questionText: "Are you authorized to work in the United States?",
      answerValue: "true",
      answerType: ANSWER_TYPE.BOOLEAN
    });

    const match = store.findAnswerForField({
      questionKey: "screener.some_ats_specific_key",
      label: "Do you have US work authorization?"
    });

    assert.ok(match, "expected a fuzzy match");
    assert.equal(match.confidence, "fuzzy");
    assert.ok(match.score >= FUZZY_MATCH_THRESHOLD);
    assert.equal(
      match.entry.questionKey,
      IDENTITY_QUESTION_KEYS.WORK_AUTHORIZATION_US
    );
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("fuzzy matching never guesses on unrelated questions", () => {
  const { db, dir } = createTempDb();

  try {
    const store = createAnswerStore(db);
    store.saveAnswer({
      kind: ANSWER_KIND.SCREENER,
      questionKey: IDENTITY_QUESTION_KEYS.SALARY_EXPECTATION,
      questionText: "What are your salary expectations?",
      answerValue: "230000",
      answerType: ANSWER_TYPE.NUMBER
    });

    const match = store.findAnswerForField({
      label: "Describe a project where you led a cross-functional team."
    });
    assert.equal(match, null);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("exact key match outranks fuzzy and reports exact confidence", () => {
  const { db, dir } = createTempDb();

  try {
    const store = createAnswerStore(db);
    store.saveAnswer({
      kind: ANSWER_KIND.IDENTITY,
      questionKey: IDENTITY_QUESTION_KEYS.EMAIL,
      answerValue: "peter.spannagle@gmail.com",
      answerType: ANSWER_TYPE.TEXT
    });

    const match = store.findAnswerForField({
      questionKey: IDENTITY_QUESTION_KEYS.EMAIL,
      label: "Email address"
    });
    assert.equal(match.confidence, "exact");
    assert.equal(match.entry.answerValue, "peter.spannagle@gmail.com");
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("recordUsage increments usage_count", () => {
  const { db, dir } = createTempDb();

  try {
    const store = createAnswerStore(db);
    const saved = store.saveAnswer({
      kind: ANSWER_KIND.LINK,
      questionKey: IDENTITY_QUESTION_KEYS.LINKEDIN_URL,
      answerValue: "https://www.linkedin.com/in/example",
      answerType: ANSWER_TYPE.URL
    });

    store.recordUsage(saved.id);
    store.recordUsage(saved.id);
    assert.equal(store.getAnswer(saved.questionKey).usageCount, 2);
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("saveAnswer validates kind, type, and required fields", () => {
  const { db, dir } = createTempDb();

  try {
    const store = createAnswerStore(db);
    assert.throws(
      () =>
        store.saveAnswer({
          kind: "mystery",
          questionKey: "x",
          answerValue: "y",
          answerType: "text"
        }),
      /Unknown answer kind/
    );
    assert.throws(
      () =>
        store.saveAnswer({
          kind: "identity",
          questionKey: "x",
          answerValue: "y",
          answerType: "hologram"
        }),
      /Unknown answer type/
    );
    assert.throws(
      () =>
        store.saveAnswer({
          kind: "identity",
          questionKey: "",
          answerValue: "y",
          answerType: "text"
        }),
      /questionKey is required/
    );
    assert.throws(
      () =>
        store.saveAnswer({
          kind: "identity",
          questionKey: "x",
          answerValue: "",
          answerType: "text"
        }),
      /answerValue is required/
    );
  } finally {
    cleanupTempDb(db, dir);
  }
});

test("questionSimilarity handles synonym folding for sponsorship phrasings", () => {
  const score = questionSimilarity(
    "Will you require visa sponsorship?",
    "Do you now or in the future require sponsorship for employment?"
  );
  assert.ok(score >= FUZZY_MATCH_THRESHOLD, `score too low: ${score}`);
});

test("CLI answers-seed + answers roundtrip (subprocess smoke)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-answers-cli-"));

  try {
    const repoRoot = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      ".."
    );
    // Isolation must be explicit, not inherited: openDatabase honors the
    // JOB_FINDER_DB env var, so a user-exported value would silently redirect
    // this subprocess at their real database (this happened — a "Test User"
    // row leaked into the stakeholder's stable DB). Always pin the subprocess
    // to the temp path.
    const env = {
      ...process.env,
      JOB_FINDER_DB: path.join(dir, "data", "jobs.db")
    };

    const seedOutput = execFileSync(
      process.execPath,
      [
        path.join(repoRoot, "src/cli.js"),
        "answers-seed",
        "--full-name",
        "Test User",
        "--email",
        "test@example.com",
        "--work-auth-us",
        "yes"
      ],
      { cwd: dir, env, encoding: "utf8" }
    );
    assert.match(seedOutput, /Seeded 3 answer\(s\)/);

    const listOutput = execFileSync(
      process.execPath,
      [path.join(repoRoot, "src/cli.js"), "answers"],
      { cwd: dir, env, encoding: "utf8" }
    );
    assert.match(listOutput, /identity\.full_name/);
    assert.match(listOutput, /screener\.work_authorization_us/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
