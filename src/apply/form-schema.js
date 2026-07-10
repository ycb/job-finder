// The form schema is the single contract between site adapters (which read a
// live application form) and the apply engine (which decides what to fill).
// Adapters produce it; src/apply/engine.js consumes it. Keeping it a plain,
// validated JSON shape is what makes the engine transport-agnostic: the same
// schema can come from an AppleScript-injected script today or a browser
// extension later.
//
// Shape:
//   {
//     url: string,
//     adapter: string,                    // e.g. "greenhouse"
//     fields: [
//       {
//         fieldId: string,               // adapter-stable handle for the input
//         label: string,                 // visible label text
//         type: "text" | "textarea" | "select" | "radio" | "checkbox"
//               | "file" | "multistep_marker",
//         required: boolean,
//         options: [{ value, label }] | null,   // for select/radio
//         sectionLabel: string | null    // enclosing section heading, if any
//       }
//     ]
//   }

export const FORM_FIELD_TYPES = Object.freeze([
  "text",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "file",
  "multistep_marker"
]);

const FIELD_TYPE_SET = new Set(FORM_FIELD_TYPES);

export function validateFormSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("Form schema must be an object.");
  }

  if (!String(schema.url || "").trim()) {
    throw new Error("Form schema requires a url.");
  }

  if (!String(schema.adapter || "").trim()) {
    throw new Error("Form schema requires an adapter id.");
  }

  if (!Array.isArray(schema.fields) || schema.fields.length === 0) {
    throw new Error("Form schema requires a non-empty fields array.");
  }

  const seenFieldIds = new Set();
  schema.fields.forEach((field, index) => {
    const context = `fields[${index}]`;

    const fieldId = String(field?.fieldId || "").trim();
    if (!fieldId) {
      throw new Error(`${context} requires a fieldId.`);
    }
    if (seenFieldIds.has(fieldId)) {
      throw new Error(`${context} duplicates fieldId "${fieldId}".`);
    }
    seenFieldIds.add(fieldId);

    if (!FIELD_TYPE_SET.has(field.type)) {
      throw new Error(
        `${context} has unsupported type "${field.type}". Supported: ${FORM_FIELD_TYPES.join(", ")}.`
      );
    }

    if (field.type !== "multistep_marker" && !String(field.label || "").trim()) {
      throw new Error(`${context} requires a label.`);
    }

    if (typeof field.required !== "boolean") {
      throw new Error(`${context} requires a boolean "required" flag.`);
    }

    if (field.options !== null && field.options !== undefined) {
      if (!Array.isArray(field.options)) {
        throw new Error(`${context} options must be an array or null.`);
      }
      field.options.forEach((option, optionIndex) => {
        if (!String(option?.label ?? "").trim()) {
          throw new Error(
            `${context}.options[${optionIndex}] requires a label.`
          );
        }
      });
    }
  });

  return true;
}
