import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CONFIG_DIR = path.join(REPO_ROOT, "config");

test("all config/*.example.json files are valid JSON", () => {
  const entries = fs.readdirSync(CONFIG_DIR, { withFileTypes: true });
  const exampleFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".example.json"))
    .map((entry) => path.join(CONFIG_DIR, entry.name))
    .sort();

  assert.ok(exampleFiles.length > 0, "Expected at least one config example file.");

  for (const filePath of exampleFiles) {
    const raw = fs.readFileSync(filePath, "utf8");
    assert.doesNotThrow(
      () => JSON.parse(raw),
      `Invalid JSON in ${path.relative(REPO_ROOT, filePath)}`
    );
  }
});
