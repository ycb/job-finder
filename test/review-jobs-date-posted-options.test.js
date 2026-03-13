import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_PATH = new URL("../src/review/web/src/App.jsx", import.meta.url);

test("jobs date posted select uses backend-supported values", () => {
  const source = fs.readFileSync(APP_PATH, "utf8");

  for (const expectedValue of ["any", "1d", "3d", "1w", "2w", "1m"]) {
    assert.match(
      source,
      new RegExp(`<option value="${expectedValue}">`),
      `expected App.jsx to include ${expectedValue} in the Jobs date posted select`,
    );
  }

  for (const unsupportedValue of ["24h", "7d", "30d"]) {
    assert.doesNotMatch(
      source,
      new RegExp(`<option value="${unsupportedValue}">`),
      `did not expect App.jsx to include unsupported value ${unsupportedValue}`,
    );
  }
});
