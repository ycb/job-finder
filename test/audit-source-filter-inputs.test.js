import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFilterElement,
  normalizeAuditResult,
  renderAuditMarkdown
} from "../scripts/audit-source-filter-inputs.js";

test("normalizeAuditResult returns stable filter map shape", () => {
  const result = normalizeAuditResult({
    sourceId: "yc-product-jobs",
    filters: [{ inputType: "typeahead", label: "Location" }, "bad-entry"]
  });

  assert.equal(result.sourceId, "yc-product-jobs");
  assert.equal(Array.isArray(result.filters), true);
  assert.equal(result.filters[0].inputType, "typeahead");
  assert.equal(result.filters.length, 1);
});

test("normalizeAuditResult handles null input safely", () => {
  const result = normalizeAuditResult(null);
  assert.equal(result.sourceId, "");
  assert.equal(Array.isArray(result.filters), true);
  assert.equal(result.filters.length, 0);
});

test("classifyFilterElement tags typeahead inputs", () => {
  const el = { role: "combobox", ariaAutocomplete: "list" };
  assert.equal(classifyFilterElement(el), "typeahead");
});

test("normalizeAuditResult applies classification when inputType missing", () => {
  const result = normalizeAuditResult({
    sourceId: "yc-product-jobs",
    filters: [{ role: "combobox", ariaAutocomplete: "list" }]
  });

  assert.equal(result.filters.length, 1);
  assert.equal(result.filters[0].inputType, "typeahead");
});

test("renderAuditMarkdown returns a markdown summary", () => {
  const md = renderAuditMarkdown([{ sourceId: "yc-product-jobs", filters: [] }]);
  assert.match(md, /yc-product-jobs/);
  assert.match(md, /Source Filter Input Audit/);
});
