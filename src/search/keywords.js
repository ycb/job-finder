function normalizeWhitespace(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseKeywordTerms(rawKeywords) {
  const normalizedInput = normalizeWhitespace(rawKeywords);
  if (!normalizedInput) {
    return [];
  }

  const terms = [];
  const seen = new Set();
  for (const segment of normalizedInput.split(",")) {
    const term = normalizeWhitespace(segment);
    if (!term) {
      continue;
    }

    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    terms.push(term);
  }

  return terms;
}

export function normalizeKeywordInput(rawKeywords) {
  const terms = parseKeywordTerms(rawKeywords);
  return {
    terms,
    canonical: terms.join(", ")
  };
}

export function keywordTermsToQueryText(rawKeywords) {
  const terms = Array.isArray(rawKeywords)
    ? rawKeywords.map((term) => normalizeWhitespace(term)).filter(Boolean)
    : parseKeywordTerms(rawKeywords);
  return terms.join(" ").trim();
}
