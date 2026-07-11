import crypto from "node:crypto";

// The answer library is the durable store of everything the user has ever
// answered on a job application: identity basics, links, document paths, and
// screener questions. The apply engine (src/apply/engine.js, Milestone 2)
// reads from it to build draft plans; the dashboard writes back newly
// answered screeners after explicit user approval. Truth-fidelity rule: the
// store never invents answers — lookups either return a saved, approved
// entry or nothing.
//
// Schema (see src/db/migrations.js `answer_library`): UUID ids and ISO
// timestamps keep rows portable to Postgres/Supabase for a later sync.

export const ANSWER_KIND = Object.freeze({
  IDENTITY: "identity",
  LINK: "link",
  DOCUMENT: "document",
  SCREENER: "screener",
  FREEFORM: "freeform"
});

export const ANSWER_TYPE = Object.freeze({
  TEXT: "text",
  BOOLEAN: "boolean",
  SELECT: "select",
  FILE_PATH: "file_path",
  URL: "url",
  NUMBER: "number"
});

const VALID_KINDS = new Set(Object.values(ANSWER_KIND));
const VALID_TYPES = new Set(Object.values(ANSWER_TYPE));

// Words that carry no signal when comparing screener question wordings.
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "can",
  "do",
  "does",
  "for",
  "have",
  "how",
  "in",
  "is",
  "of",
  "or",
  "please",
  "the",
  "this",
  "to",
  "what",
  "will",
  "with",
  "would",
  "you",
  "your"
]);

// Light synonym folding so common ATS phrasings of the same screener match:
// "authorized to work" vs "work authorization", "sponsorship" variants, etc.
const TOKEN_SYNONYMS = new Map([
  ["authorised", "authorized"],
  ["authorization", "authorized"],
  ["visa", "sponsorship"],
  ["sponsor", "sponsorship"],
  ["compensation", "salary"],
  ["pay", "salary"],
  ["remuneration", "salary"],
  ["located", "location"],
  ["relocate", "relocation"],
  ["us", "united-states"],
  ["u.s", "united-states"],
  ["usa", "united-states"],
  ["states", "united-states"]
]);

export function normalizeQuestionTokens(text) {
  const tokens = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .split(/[\s/]+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean)
    .map((token) => TOKEN_SYNONYMS.get(token) || token)
    .filter((token) => !STOPWORDS.has(token));

  return new Set(tokens);
}

export function questionSimilarity(textA, textB) {
  const tokensA = normalizeQuestionTokens(textA);
  const tokensB = normalizeQuestionTokens(textB);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(tokensA.size, tokensB.size);
}

// Minimum overlap ratio for a fuzzy screener match. Conservative on purpose:
// a wrong pre-filled answer is worse than an unanswered field routed to the
// user (truth fidelity beats coverage).
export const FUZZY_MATCH_THRESHOLD = 0.75;

function nowIso() {
  return new Date().toISOString();
}

function rowToEntry(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    kind: row.kind,
    questionKey: row.question_key,
    questionText: row.question_text ?? null,
    answerValue: row.answer_value,
    answerType: row.answer_type,
    tags: row.tags ? JSON.parse(row.tags) : [],
    approved: Boolean(row.approved),
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createAnswerStore(db) {
  function getAnswer(questionKey) {
    const row = db
      .prepare(
        `SELECT * FROM answer_library WHERE question_key = ? AND approved = 1`
      )
      .get(String(questionKey || "").trim());

    return rowToEntry(row);
  }

  function listAnswers() {
    return db
      .prepare(`SELECT * FROM answer_library ORDER BY question_key ASC`)
      .all()
      .map(rowToEntry);
  }

  // Field lookup used by the draft engine. Resolution order:
  // 1. exact canonical key match (confidence "exact");
  // 2. fuzzy question-text match against saved screener/freeform entries
  //    (confidence "fuzzy", threshold FUZZY_MATCH_THRESHOLD).
  // Returns null when nothing clears the bar — never guesses.
  function findAnswerForField({ questionKey, label } = {}) {
    const normalizedKey = String(questionKey || "").trim();
    if (normalizedKey) {
      const exact = getAnswer(normalizedKey);
      if (exact) {
        return { entry: exact, confidence: "exact" };
      }
    }

    const labelText = String(label || "").trim();
    if (!labelText) {
      return null;
    }

    const candidates = db
      .prepare(
        `SELECT * FROM answer_library
         WHERE approved = 1
           AND kind IN ('${ANSWER_KIND.SCREENER}', '${ANSWER_KIND.FREEFORM}')
           AND question_text IS NOT NULL`
      )
      .all();

    let best = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = questionSimilarity(labelText, candidate.question_text);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (best && bestScore >= FUZZY_MATCH_THRESHOLD) {
      return { entry: rowToEntry(best), confidence: "fuzzy", score: bestScore };
    }

    return null;
  }

  function saveAnswer({
    kind,
    questionKey,
    questionText = null,
    answerValue,
    answerType,
    tags = [],
    approved = true
  } = {}) {
    const normalizedKind = String(kind || "").trim();
    const normalizedKey = String(questionKey || "").trim();
    const normalizedType = String(answerType || "").trim();

    if (!VALID_KINDS.has(normalizedKind)) {
      throw new Error(
        `Unknown answer kind "${normalizedKind}". Valid kinds: ${[...VALID_KINDS].join(", ")}.`
      );
    }
    if (!normalizedKey) {
      throw new Error("questionKey is required to save an answer.");
    }
    if (!VALID_TYPES.has(normalizedType)) {
      throw new Error(
        `Unknown answer type "${normalizedType}". Valid types: ${[...VALID_TYPES].join(", ")}.`
      );
    }
    if (answerValue === undefined || answerValue === null || answerValue === "") {
      throw new Error("answerValue is required to save an answer.");
    }

    const timestamp = nowIso();
    const existing = db
      .prepare(`SELECT id, created_at FROM answer_library WHERE question_key = ?`)
      .get(normalizedKey);

    if (existing) {
      db.prepare(
        `UPDATE answer_library
         SET kind = ?, question_text = ?, answer_value = ?, answer_type = ?,
             tags = ?, approved = ?, updated_at = ?
         WHERE question_key = ?`
      ).run(
        normalizedKind,
        questionText,
        String(answerValue),
        normalizedType,
        JSON.stringify(tags),
        approved ? 1 : 0,
        timestamp,
        normalizedKey
      );

      return getAnswer(normalizedKey) || rowToEntry(
        db.prepare(`SELECT * FROM answer_library WHERE question_key = ?`).get(normalizedKey)
      );
    }

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO answer_library
         (id, kind, question_key, question_text, answer_value, answer_type,
          tags, approved, usage_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      id,
      normalizedKind,
      normalizedKey,
      questionText,
      String(answerValue),
      normalizedType,
      JSON.stringify(tags),
      approved ? 1 : 0,
      timestamp,
      timestamp
    );

    return rowToEntry(
      db.prepare(`SELECT * FROM answer_library WHERE id = ?`).get(id)
    );
  }

  function recordUsage(id) {
    db.prepare(
      `UPDATE answer_library
       SET usage_count = usage_count + 1, updated_at = ?
       WHERE id = ?`
    ).run(nowIso(), String(id || ""));
  }

  return { getAnswer, findAnswerForField, saveAnswer, recordUsage, listAnswers };
}

// Canonical identity keys seeded during onboarding (`jf answers-seed`) and
// mapped by adapters to standard ATS fields in Milestone 2.
export const IDENTITY_QUESTION_KEYS = Object.freeze({
  FULL_NAME: "identity.full_name",
  FIRST_NAME: "identity.first_name",
  LAST_NAME: "identity.last_name",
  EMAIL: "identity.email",
  PHONE: "identity.phone",
  LOCATION: "identity.location",
  LINKEDIN_URL: "link.linkedin",
  WEBSITE_URL: "link.website",
  GITHUB_URL: "link.github",
  RESUME_PATH: "document.resume",
  WORK_AUTHORIZATION_US: "screener.work_authorization_us",
  REQUIRES_SPONSORSHIP: "screener.requires_sponsorship",
  SALARY_EXPECTATION: "screener.salary_expectation"
});
