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

test("Levels.fyi registers in the source library and accepts direct HTTP config", () => {
  const definitions = listSourceLibraryDefinitions();
  const levels = definitions.find((entry) => entry.type === "levelsfyi_search");

  assert.ok(levels, "expected Levels.fyi in the source library");
  assert.equal(levels.id, "levelsfyi-ai-pm");
  assert.equal(levels.name, "Levels.fyi");
  assert.equal(levels.enabled, false);
  assert.equal(levels.cacheTtlHours, 12);
  assert.equal(getDefaultCacheTtlHours("levelsfyi_search"), 12);
  assert.deepEqual(getSourceAggregationIds(levels), ["levelsfyi-ai-pm"]);

  const enabledMap = defaultSourceEnabledMap();
  assert.equal(enabledMap[levels.id], false);

  const materialized = materializeSourcesFromLibraryMap({
    [levels.id]: { enabled: true }
  });
  const materializedLevels = materialized.find((entry) => entry.id === levels.id);

  assert.ok(materializedLevels, "expected materialized Levels.fyi entry");
  assert.equal(materializedLevels.enabled, true);
  assert.equal(materializedLevels.type, "levelsfyi_search");

  const parsed = validateSources({
    sources: [
      {
        id: levels.id,
        name: levels.name,
        type: levels.type,
        enabled: true,
        searchUrl: levels.searchUrl,
        capturePath: "data/captures/levelsfyi-ai-pm.json",
        maxJobs: 40,
        cacheTtlHours: 12
      }
    ]
  });

  assert.equal(parsed.sources[0].type, "levelsfyi_search");
  assert.equal(parsed.sources[0].capturePath, "data/captures/levelsfyi-ai-pm.json");
  assert.equal(parsed.sources[0].maxJobs, 40);
});
