import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAuditResult } from "../scripts/audit-source-filter-inputs.js";

test("normalizeAuditResult returns stable filter map shape", () => {
  const result = normalizeAuditResult({
    sourceId: "yc-product-jobs",
    filters: [{ inputType: "typeahead", label: "Location" }]
  });

  assert.equal(result.sourceId, "yc-product-jobs");
  assert.equal(Array.isArray(result.filters), true);
  assert.equal(result.filters[0].inputType, "typeahead");
});
