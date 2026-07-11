#!/usr/bin/env node
// QA demo for the apply engine (Milestone 2 of
// docs/plans/2026-07-10-apply-engine-mvp-execplan.md).
//
// Builds a draft plan against a saved real-form fixture using YOUR actual
// answer library (data/jobs.db), and prints what would be filled, what would
// be asked, and what is deliberately skipped. Nothing touches a browser and
// nothing is submitted — this is the engine's output made visible.
//
// Usage (from the repository root):
//   node scripts/apply-draft-demo.js
//   node scripts/apply-draft-demo.js test/fixtures/apply/linkedin-easy-apply-schema.json
//   node scripts/apply-draft-demo.js --db /tmp/demo.db

import fs from "node:fs";
import path from "node:path";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { createAnswerStore } from "../src/apply/answer-store.js";
import { buildDraftPlan } from "../src/apply/engine.js";

const args = process.argv.slice(2);
let dbPath = process.env.JOB_FINDER_DB || "data/jobs.db";
let fixturePath = "test/fixtures/apply/greenhouse-gitlab-schema.json";

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--db") {
    dbPath = args[i + 1];
    i += 1;
  } else if (!args[i].startsWith("--")) {
    fixturePath = args[i];
  }
}

const resolvedFixture = path.resolve(fixturePath);
if (!fs.existsSync(resolvedFixture)) {
  console.error(`Fixture not found: ${resolvedFixture}`);
  process.exit(1);
}

const formSchema = JSON.parse(fs.readFileSync(resolvedFixture, "utf8"));
const { db } = openDatabase(dbPath);
runMigrations(db);
const answerStore = createAnswerStore(db);

const savedCount = answerStore.listAnswers().length;
const { plan, unanswered, skipped } = buildDraftPlan({ formSchema, answerStore });

const total = formSchema.fields.filter((f) => f.type !== "multistep_marker").length;

console.log("");
console.log(`Form:    ${formSchema.url}`);
console.log(`Adapter: ${formSchema.adapter}`);
console.log(`Library: ${savedCount} saved answer(s) in ${path.resolve(dbPath)}`);
console.log("");
console.log(`WOULD FILL (${plan.length} of ${total} fields)`);
for (const item of plan) {
  const tag = item.confidence === "exact" ? "exact" : `fuzzy`;
  console.log(`  ✓ ${item.label}`);
  console.log(`      → "${item.proposedValue}"  [${item.questionKey}, ${tag}]`);
}

console.log("");
console.log(`WOULD ASK YOU (${unanswered.length})`);
for (const item of unanswered) {
  const req = item.required ? "required" : "optional";
  console.log(`  ? ${item.label}  (${item.fieldType}, ${req})`);
}

console.log("");
console.log(`SKIPPED — demographic/EEO, never auto-filled (${skipped.length})`);
for (const item of skipped) {
  console.log(`  – ${item.label}`);
}

console.log("");
console.log(
  "Answering the WOULD ASK items once (jf answers-seed / dashboard in M3) makes the next draft fill them automatically."
);
