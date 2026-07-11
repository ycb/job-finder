import { validateFormSchema } from "./form-schema.js";
import {
  demographicQuestionKey,
  isDemographicField,
  mapLabelToQuestionKey
} from "./field-mapping.js";
import {
  applyRequiredDemographicPolicy,
  applySalaryPolicy,
  findFallbackAnswer,
  isSalaryField
} from "./answer-policies.js";

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
//     plan: [{ fieldId, label, fieldType, proposedValue,
//              source: "library" | "policy",
//              questionKey, answerId, policyId?, note?,
//              confidence: "exact" | "fuzzy" | "fallback" | "policy" }],
//     unanswered: [{ fieldId, label, fieldType, required, options, note? }],
//     skipped: [{ fieldId, label, reason: "demographic" }]
//   }
//
// Resolution order per field: explicit library answer (exact, then fuzzy) →
// library fallback chain (e.g. website → github) → answer policies (salary
// strategy, required-demographic decline) → unanswered. Policies encode the
// user's stated strategies (see answer-policies.js), not invented facts.

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

  // Select fields with non-boolean answers: propose when the saved answer
  // matches an option exactly (case-insensitive), or — conservatively — when
  // one meaningfully contains the other ("United States" vs "United States
  // of America", "San Francisco, CA" vs "San Francisco"). Containment only
  // counts for strings longer than 3 chars to keep "No"/"None" style labels
  // from cross-matching.
  if (field.type === "select" || field.type === "radio") {
    const saved = String(entry.answerValue).trim().toLowerCase();
    const options = field.options || [];

    const exact = options.find(
      (option) => String(option.label || "").trim().toLowerCase() === saved
    );
    if (exact) {
      return String(exact.label);
    }

    if (saved.length > 3) {
      const contained = options.filter((option) => {
        const optionLabel = String(option.label || "").trim().toLowerCase();
        return (
          optionLabel.length > 3 &&
          (optionLabel.includes(saved) || saved.includes(optionLabel))
        );
      });
      if (contained.length === 1) {
        return String(contained[0].label);
      }
    }

    return null;
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

    // Demographic fields: exact demographic.* opt-in first; never fuzzy.
    // Optional -> blank ("skipped"). Required -> decline-to-state option per
    // policy; if the form offers no decline option, route to the user.
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

      if (field.required) {
        const policy = applyRequiredDemographicPolicy({ field });
        if (policy) {
          plan.push({
            fieldId: field.fieldId,
            label: field.label,
            fieldType: field.type,
            proposedValue: policy.value,
            source: "policy",
            policyId: policy.policyId,
            note: policy.note,
            questionKey: null,
            answerId: null,
            confidence: "policy"
          });
          continue;
        }

        unanswered.push({
          fieldId: field.fieldId,
          label: field.label,
          fieldType: field.type,
          required: true,
          options: field.options || null,
          note: "Required demographic question with no decline option — needs your call."
        });
        continue;
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

    // Library fallback chains: e.g. portfolio/website fields fall back to a
    // saved GitHub URL when no dedicated website answer exists.
    if (questionKey) {
      const fallback = findFallbackAnswer(answerStore, questionKey);
      if (fallback) {
        const value = coerceValueForField(field, fallback);
        if (value !== null) {
          plan.push({
            fieldId: field.fieldId,
            label: field.label,
            fieldType: field.type,
            proposedValue: value,
            source: "library",
            questionKey: fallback.questionKey,
            answerId: fallback.id,
            confidence: "fallback"
          });
          continue;
        }
      }
    }

    // Salary policy: free-text -> "Let's discuss"; numeric-required -> top of
    // the job's advertised range, else sentinel. Library answers (handled
    // above) always outrank the policy.
    if (isSalaryField(field)) {
      const policy = applySalaryPolicy({ field, job });
      if (policy) {
        plan.push({
          fieldId: field.fieldId,
          label: field.label,
          fieldType: field.type,
          proposedValue: policy.value,
          source: "policy",
          policyId: policy.policyId,
          note: policy.note,
          questionKey: null,
          answerId: null,
          confidence: "policy"
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
