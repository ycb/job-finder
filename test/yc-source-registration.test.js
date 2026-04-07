import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultSourceEnabledMap,
  getSourceAggregationIds,
  listSourceLibraryDefinitions,
  materializeSourcesFromLibraryMap
} from "../src/config/source-library.js";
import { validateSources } from "../src/config/schema.js";
import { getDefaultCacheTtlHours } from "../src/sources/cache-policy.js";

test("YC Jobs registers in the source library and accepts direct HTTP config", () => {
  const definitions = listSourceLibraryDefinitions();
  const yc = definitions.find((entry) => entry.type === "yc_jobs");

  assert.ok(yc, "expected YC Jobs in the source library");
  assert.equal(yc.id, "yc-product-jobs");
  assert.equal(yc.name, "YC Jobs");
  assert.equal(yc.enabled, false);
  assert.equal(getDefaultCacheTtlHours("yc_jobs"), 12);
  assert.deepEqual(getSourceAggregationIds(yc), ["yc-product-jobs"]);

  const enabledMap = defaultSourceEnabledMap();
  assert.equal(enabledMap[yc.id], false);

  const materialized = materializeSourcesFromLibraryMap({
    [yc.id]: { enabled: true }
  });
  const materializedYc = materialized.find((entry) => entry.id === yc.id);

  assert.ok(materializedYc, "expected materialized YC entry");
  assert.equal(materializedYc.enabled, true);
  assert.equal(materializedYc.type, "yc_jobs");

  const parsed = validateSources({
    sources: [
      {
        id: yc.id,
        name: yc.name,
        type: yc.type,
        enabled: true,
        searchUrl: yc.searchUrl,
        capturePath: "data/captures/yc-product-jobs.json",
        maxJobs: 50
      }
    ]
  });

  assert.equal(parsed.sources[0].type, "yc_jobs");
  assert.equal(parsed.sources[0].capturePath, "data/captures/yc-product-jobs.json");
  assert.equal(parsed.sources[0].maxJobs, 50);
});
