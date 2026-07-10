import { validateFormSchema } from "./form-schema.js";
import {
  demographicQuestionKey,
  isDemographicField,
  mapLabelToQuestionKey
} from "./field-mapping.js";

// The apply engine turns a form schema (from a site adapter) plus the user's
// answer library into a draft plan: what to fill, with what value, and why.
//
// Design rules, enforced here and by tests:
// - Truth fidelity: the engine never fabricates an answer. A field either
//   resolves to a saved, approved library entry or lands in `unanswered`.
// - Demographic/EEO fields are never fuzzy-matched; they stay blank
//   (bucket `skipped`) unless an exact, explicitly saved `demographic.*`
//   answer exists.
// - Transport-agnostic: this module must not import from src/browser-bridge/
//   or src/review/ (a test enforces it) so the same engine can run inside a
//   future browser extension.
//
// Output shape:
//   {
//     plan: [{ fieldId, label, fieldType, proposedValue, source: "library",
//              questionKey, answerId, confidence: "exact" | "fuzzy" }],
//     unanswered: [{ fieldId, label, fieldType, required, options }],
//     skipped: [{ fieldId, label, reason: "demographic" }]
//   }

function coerceValueForField(field, entry) {
  // Boolean library answers meet select/radio inputs constantly
  // ("Yes"/"No" dropdowns). Only coerce when the field's own options
  // contain an unambiguous yes/no label; otherwise refuse (null).
  if (
    entry.answerType === "boolean" &&
    (field.type === "select" || field.type === "radio")
  ) {
    const wantYes = entry.answerValue === "true";
    const target = (field.options || []).find((option) => {
      const optionLabel = String(option.label || "").trim().toLowerCase();
      return wantYes
        ? optionLabel === "yes" || optionLabel === "true"
        : optionLabel === "no" || optionLabel === "false";
    });
    return target ? String(target.label) : null;
  }

  if (entry.answerType === "boolean") {
    return entry.answerValue === "true" ? "Yes" : "No";
  }

  // Select fields with non-boolean answers: only propose when the saved
  // answer matches one of the field's options (case-insensitive), because
  // typing free text into a dropdown is meaningless.
  if (field.type === "select" || field.type === "radio") {
    const saved = String(entry.answerValue).trim().toLowerCase();
    const match = (field.options || []).find(
      (option) => String(option.label || "").trim().toLowerCase() === saved
    );
    return match ? String(match.label) : null;
  }

  return String(entry.answerValue);
}

export function buildDraftPlan({ formSchema, answerStore, job } = {}) {
  validateFormSchema(formSchema);
  if (!answerStore || typeof answerStore.findAnswerForField !== "function") {
    throw new Error("buildDraftPlan requires an answerStore.");
  }

  const plan = [];
  const unanswered = [];
  const skipped = [];

  for (const field of formSchema.fields) {
    if (field.type === "multistep_marker") {
      continue;
    }

    // Demographic fields: exact demographic.* opt-in or blank. Never fuzzy.
    if (isDemographicField(field)) {
      const explicit = answerStore.getAnswer(demographicQuestionKey(field.label));
      if (explicit) {
        const value = coerceValueForField(field, explicit);
        if (value !== null) {
          plan.push({
            fieldId: field.fieldId,
            label: field.label,
            fieldType: field.type,
            proposedValue: value,
            source: "library",
            questionKey: explicit.questionKey,
            answerId: explicit.id,
            confidence: "exact"
          });
          continue;
        }
      }
      skipped.push({
        fieldId: field.fieldId,
        label: field.label,
        reason: "demographic"
      });
      continue;
    }

    const questionKey = mapLabelToQuestionKey(field.label);
    const match = answerStore.findAnswerForField({
      questionKey,
      label: field.label
    });

    if (match) {
      const value = coerceValueForField(field, match.entry);
      if (value !== null) {
        plan.push({
          fieldId: field.fieldId,
          label: field.label,
          fieldType: field.type,
          proposedValue: value,
          source: "library",
          questionKey: match.entry.questionKey,
          answerId: match.entry.id,
          confidence: match.confidence
        });
        continue;
      }
    }

    unanswered.push({
      fieldId: field.fieldId,
      label: field.label,
      fieldType: field.type,
      required: field.required,
      options: field.options || null
    });
  }

  return { plan, unanswered, skipped, jobId: job?.id ?? null };
}
