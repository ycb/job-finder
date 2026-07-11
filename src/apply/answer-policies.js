// Answer policies: rule-based fallbacks the engine applies when the answer
// library alone cannot resolve a field. Policies are the second stage of
// resolution — library answers always win — and every policy-produced value
// is labeled source:"policy" with a policyId so the confirm UI can show
// exactly why a value was proposed. Truth fidelity still holds: policies
// encode the user's own stated strategies (see Decision Log in
// docs/plans/2026-07-10-apply-engine-mvp-execplan.md), never invented facts.

// --- Option preference matching --------------------------------------------

// Pick the first form option whose label matches any of the preference
// patterns, in pattern order. Used for "same intent, different label" cases:
// EEO decline options, yes/no variants, etc.
export function pickOptionByPreference(options, patterns) {
  for (const pattern of patterns) {
    const match = (options || []).find((option) =>
      pattern.test(String(option.label || ""))
    );
    if (match) {
      return String(match.label);
    }
  }
  return null;
}

export const DECLINE_TO_STATE_PATTERNS = [
  /decline to (self.?.?identify|state|answer|disclose)/i,
  /don'?t wish to answer/i,
  /do not (wish|want) to (answer|disclose|say)/i,
  /prefer not to (say|answer|disclose|state)/i,
  /rather not say/i
];

// --- Salary ------------------------------------------------------------------

const SALARY_LABEL_PATTERN =
  /salary|compensation|(expected|desired) pay|pay (expectation|requirement|range)|remuneration/i;

export function isSalaryField({ label } = {}) {
  return SALARY_LABEL_PATTERN.test(String(label || ""));
}

// Parse the top of a salary range out of free text like
// "$150,000 - $180,000 USD", "150k–180k", "$185,000/yr". Returns an integer
// number of currency units, or null when no usable number is present.
export function parseTopOfSalaryRange(salaryText) {
  const text = String(salaryText || "");
  const matches = [...text.matchAll(/\$?\s*(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*(k)?/gi)]
    .map((match) => {
      let value = Number(String(match[1]).replace(/[,.](?=\d{3}\b)/g, ""));
      if (match[2]) {
        value *= 1000;
      }
      return value;
    })
    .filter((value) => Number.isFinite(value) && value >= 1000 && value < 10_000_000);

  if (matches.length === 0) {
    return null;
  }

  return Math.max(...matches);
}

// The user's stated salary strategy (stakeholder direction 2026-07-10):
// - free-text field: "Let's discuss" (unless the library has an explicit
//   salary answer, which the engine resolves before policies run);
// - numeric-required field: top of the range the job itself advertises;
// - numeric-required with no advertised range: a realistic location-based
//   default — $225,000 for San Francisco roles, $200,000 for remote or
//   elsewhere.
export const SALARY_DEFAULT_SF = 225000;
export const SALARY_DEFAULT_OTHER = 200000;

const SF_LOCATION_PATTERN = /san\s*francisco|\bsf\b(?![a-z])|\bbay\s*area\b/i;

export function applySalaryPolicy({ field, job } = {}) {
  if (field.type === "number") {
    const top = parseTopOfSalaryRange(job?.salary_text ?? job?.salaryText);
    if (top !== null) {
      return {
        value: String(top),
        policyId: "salary.top_of_listed_range",
        note: `Top of the range listed on the job (${job?.salary_text || job?.salaryText}).`
      };
    }

    const isSf = SF_LOCATION_PATTERN.test(String(job?.location || ""));
    return {
      value: String(isSf ? SALARY_DEFAULT_SF : SALARY_DEFAULT_OTHER),
      policyId: isSf ? "salary.default_sf" : "salary.default_other",
      note: isSf
        ? "No range listed; San Francisco default per your salary policy."
        : "No range listed; remote/elsewhere default per your salary policy."
    };
  }

  if (field.type === "text" || field.type === "textarea") {
    return {
      value: "Let's discuss",
      policyId: "salary.lets_discuss",
      note: "Default salary answer for free-text fields."
    };
  }

  return null;
}

// --- Demographic (EEO) -------------------------------------------------------

// Optional demographic fields stay blank (engine bucket "skipped").
// Required demographic fields get the decline-to-state option when the form
// offers one; otherwise they surface as unanswered for the user.
export function applyRequiredDemographicPolicy({ field } = {}) {
  if (field.type !== "select" && field.type !== "radio") {
    return null;
  }

  const label = pickOptionByPreference(field.options, DECLINE_TO_STATE_PATTERNS);
  if (!label) {
    return null;
  }

  return {
    value: label,
    policyId: "demographic.decline_when_required",
    note: "Required demographic question; declined per your policy."
  };
}

// --- Library fallback chains -------------------------------------------------

// When a canonical key has no saved answer, these keys are tried next, in
// order. Example: portfolio/website fields fall back to the saved GitHub URL.
export const QUESTION_KEY_FALLBACKS = Object.freeze({
  "link.website": ["link.github"],
  "identity.full_name": ["identity.first_name+identity.last_name"]
});

// Resolve a fallback token: either a plain question key or a "+"-joined
// composition of keys (values joined with a space).
export function resolveFallbackEntry(answerStore, token) {
  if (!token.includes("+")) {
    return answerStore.getAnswer(token);
  }

  const parts = token.split("+").map((key) => answerStore.getAnswer(key.trim()));
  if (parts.some((part) => !part)) {
    return null;
  }

  return {
    id: parts[0].id,
    kind: parts[0].kind,
    questionKey: token,
    questionText: null,
    answerValue: parts.map((part) => part.answerValue).join(" "),
    answerType: "text",
    tags: [],
    approved: parts.every((part) => part.approved),
    usageCount: 0
  };
}

export function findFallbackAnswer(answerStore, questionKey) {
  for (const token of QUESTION_KEY_FALLBACKS[questionKey] || []) {
    const entry = resolveFallbackEntry(answerStore, token);
    if (entry) {
      return entry;
    }
  }
  return null;
}
