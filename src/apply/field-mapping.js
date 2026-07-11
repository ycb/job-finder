import { IDENTITY_QUESTION_KEYS } from "./answer-store.js";

// Maps visible form labels to canonical answer-library question keys.
// Canonicalization is deliberately conservative: only unambiguous standard
// ATS labels get direct mappings; everything else falls through to fuzzy
// screener matching in the answer store, and below that to "unanswered".

export function normalizeLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/\*/g, " ")
    .replace(/[^\p{L}\p{N}\s/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DIRECT_LABEL_MAPPINGS = new Map([
  ["first name", IDENTITY_QUESTION_KEYS.FIRST_NAME],
  ["given name", IDENTITY_QUESTION_KEYS.FIRST_NAME],
  ["last name", IDENTITY_QUESTION_KEYS.LAST_NAME],
  ["family name", IDENTITY_QUESTION_KEYS.LAST_NAME],
  ["surname", IDENTITY_QUESTION_KEYS.LAST_NAME],
  ["full name", IDENTITY_QUESTION_KEYS.FULL_NAME],
  ["name", IDENTITY_QUESTION_KEYS.FULL_NAME],
  ["your name", IDENTITY_QUESTION_KEYS.FULL_NAME],
  ["email", IDENTITY_QUESTION_KEYS.EMAIL],
  ["email address", IDENTITY_QUESTION_KEYS.EMAIL],
  ["phone", IDENTITY_QUESTION_KEYS.PHONE],
  ["phone number", IDENTITY_QUESTION_KEYS.PHONE],
  ["mobile number", IDENTITY_QUESTION_KEYS.PHONE],
  ["mobile phone", IDENTITY_QUESTION_KEYS.PHONE],
  ["mobile phone number", IDENTITY_QUESTION_KEYS.PHONE],
  ["location", IDENTITY_QUESTION_KEYS.LOCATION],
  ["location city", IDENTITY_QUESTION_KEYS.LOCATION],
  ["city", IDENTITY_QUESTION_KEYS.LOCATION],
  ["current location", IDENTITY_QUESTION_KEYS.LOCATION],
  ["linkedin", IDENTITY_QUESTION_KEYS.LINKEDIN_URL],
  ["linkedin profile", IDENTITY_QUESTION_KEYS.LINKEDIN_URL],
  ["linkedin url", IDENTITY_QUESTION_KEYS.LINKEDIN_URL],
  ["website", IDENTITY_QUESTION_KEYS.WEBSITE_URL],
  ["personal website", IDENTITY_QUESTION_KEYS.WEBSITE_URL],
  ["portfolio", IDENTITY_QUESTION_KEYS.WEBSITE_URL],
  ["portfolio url", IDENTITY_QUESTION_KEYS.WEBSITE_URL],
  ["portfolio link", IDENTITY_QUESTION_KEYS.WEBSITE_URL],
  ["portfolio website", IDENTITY_QUESTION_KEYS.WEBSITE_URL],
  ["github", IDENTITY_QUESTION_KEYS.GITHUB_URL],
  ["github url", IDENTITY_QUESTION_KEYS.GITHUB_URL],
  ["github profile", IDENTITY_QUESTION_KEYS.GITHUB_URL],
  ["resume", IDENTITY_QUESTION_KEYS.RESUME_PATH],
  ["resume/cv", IDENTITY_QUESTION_KEYS.RESUME_PATH],
  ["cv", IDENTITY_QUESTION_KEYS.RESUME_PATH],
  ["upload resume", IDENTITY_QUESTION_KEYS.RESUME_PATH],
  ["resume upload", IDENTITY_QUESTION_KEYS.RESUME_PATH],
  ["attach resume", IDENTITY_QUESTION_KEYS.RESUME_PATH]
]);

export function mapLabelToQuestionKey(label) {
  return DIRECT_LABEL_MAPPINGS.get(normalizeLabel(label)) || null;
}

// Demographic / EEO self-identification fields are never auto-filled from
// fuzzy matching. They are voluntary, legally sensitive, and a wrong
// pre-filled value is materially worse than a blank. The engine drafts them
// blank (bucket "skipped") unless the user has explicitly saved an exact
// `demographic.*` answer for that question.
const DEMOGRAPHIC_LABEL_PATTERNS = [
  /\bgender\b/i,
  /\bhispanic\b|\blatino\b/i,
  /\brace\b|\bethnicit/i,
  /\bveteran\b/i,
  /\bdisabilit/i,
  /self[- ]identification/i
];

const DEMOGRAPHIC_SECTION_PATTERNS = [
  /self[- ]identification/i,
  /\beeo\b/i,
  /equal employment/i,
  /demographic/i
];

export function isDemographicField({ label, sectionLabel } = {}) {
  const labelText = String(label || "");
  if (DEMOGRAPHIC_LABEL_PATTERNS.some((pattern) => pattern.test(labelText))) {
    return true;
  }

  const sectionText = String(sectionLabel || "");
  return DEMOGRAPHIC_SECTION_PATTERNS.some((pattern) =>
    pattern.test(sectionText)
  );
}

// Explicit opt-in key namespace for demographic answers, looked up exact-only.
export function demographicQuestionKey(label) {
  const slug = normalizeLabel(label)
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 64);
  return `demographic.${slug}`;
}
