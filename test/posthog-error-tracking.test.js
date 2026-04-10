import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createPosthogNodeErrorTrackingClient,
  resolvePosthogConfig
} from "../src/analytics/posthog-config.js";

test("resolvePosthogConfig loads token and host from .env", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-posthog-config-"));
  const previousCwd = process.cwd();
  const previousToken = process.env.POSTHOG_API_KEY;
  const previousHost = process.env.POSTHOG_HOST;

  try {
    fs.writeFileSync(
      path.join(tempDir, ".env"),
      "POSTHOG_API_KEY=phc_test_from_dotenv\nPOSTHOG_HOST=https://dotenv.posthog.local\n",
      "utf8"
    );
    process.chdir(tempDir);
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;

    const config = resolvePosthogConfig();
    assert.equal(config.apiKey, "phc_test_from_dotenv");
    assert.equal(config.host, "https://dotenv.posthog.local");
  } finally {
    process.chdir(previousCwd);
    if (previousToken === undefined) {
      delete process.env.POSTHOG_API_KEY;
    } else {
      process.env.POSTHOG_API_KEY = previousToken;
    }
    if (previousHost === undefined) {
      delete process.env.POSTHOG_HOST;
    } else {
      process.env.POSTHOG_HOST = previousHost;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createPosthogNodeErrorTrackingClient enables exception autocapture", () => {
  const calls = [];

  class FakePostHog {
    constructor(apiKey, options) {
      calls.push({ apiKey, options });
    }
  }

  const client = createPosthogNodeErrorTrackingClient({
    apiKey: "phc_test",
    host: "https://us.i.posthog.com",
    PostHogCtor: FakePostHog,
  });

  assert.ok(client instanceof FakePostHog);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, "phc_test");
  assert.equal(calls[0].options.host, "https://us.i.posthog.com");
  assert.equal(calls[0].options.enableExceptionAutocapture, true);
});

test("createPosthogNodeErrorTrackingClient returns null when token is absent", () => {
  class FakePostHog {}

  const client = createPosthogNodeErrorTrackingClient({
    apiKey: "",
    host: "https://us.i.posthog.com",
    PostHogCtor: FakePostHog,
  });

  assert.equal(client, null);
});
