import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BRIDGE_PRIMITIVE_ID,
  BRIDGE_SURFACE,
  validatePrimitiveSurfaceRegistration
} from "../src/browser-bridge/primitives.js";
import {
  buildBridgeRouteMap,
  startBrowserBridgeServer
} from "../src/browser-bridge/server.js";
import {
  hasApplyAutomationConsent,
  recordApplyAutomationConsent
} from "../src/apply/consent.js";

function createTempSettingsPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-apply-consent-"));
  return { dir, settingsPath: path.join(dir, "user-settings.json") };
}

test("apply_v1 accepts read primitives plus type-text and upload-file", () => {
  validatePrimitiveSurfaceRegistration({
    surface: BRIDGE_SURFACE.APPLY_V1,
    primitiveIds: [
      BRIDGE_PRIMITIVE_ID.FORM_EXTRACT_SCHEMA,
      BRIDGE_PRIMITIVE_ID.FORM_TYPE_TEXT,
      BRIDGE_PRIMITIVE_ID.FORM_UPLOAD_FILE
    ]
  });
});

test("apply_click can never be registered, even on apply_v1", () => {
  assert.throws(
    () =>
      validatePrimitiveSurfaceRegistration({
        surface: BRIDGE_SURFACE.APPLY_V1,
        primitiveIds: [BRIDGE_PRIMITIVE_ID.APPLY_CLICK]
      }),
    /may never be exposed on any surface/
  );
});

test("dialog confirmation can never be registered, even on apply_v1", () => {
  assert.throws(
    () =>
      validatePrimitiveSurfaceRegistration({
        surface: BRIDGE_SURFACE.APPLY_V1,
        primitiveIds: [BRIDGE_PRIMITIVE_ID.DIALOG_CONFIRM_ACTION]
      }),
    /may never be exposed on any surface/
  );
});

test("mcp_v1 still rejects apply write primitives", () => {
  assert.throws(
    () =>
      validatePrimitiveSurfaceRegistration({
        surface: BRIDGE_SURFACE.MCP_V1,
        primitiveIds: [BRIDGE_PRIMITIVE_ID.FORM_TYPE_TEXT]
      }),
    /MCP v1 cannot expose write primitives/
  );
});

test("unknown surfaces are rejected outright (deny by default)", () => {
  assert.throws(
    () =>
      validatePrimitiveSurfaceRegistration({
        surface: "mystery_surface",
        primitiveIds: [BRIDGE_PRIMITIVE_ID.HEALTH_CHECK]
      }),
    /Unknown bridge surface/
  );
});

test("mcp_v1 route map has no /apply routes; apply_v1 map has only /apply routes", () => {
  const mcpRoutes = buildBridgeRouteMap(
    { name: "noop", captureSource: () => ({}), probeSourceAccess: () => ({}) },
    { surface: BRIDGE_SURFACE.MCP_V1 }
  );
  for (const key of mcpRoutes.keys()) {
    assert.ok(!key.includes("/apply/"), `mcp_v1 leaked apply route: ${key}`);
  }

  const applyRoutes = buildBridgeRouteMap(
    { name: "noop" },
    { surface: BRIDGE_SURFACE.APPLY_V1 }
  );
  assert.ok(applyRoutes.size >= 3, "expected apply_v1 routes to exist");
  for (const key of applyRoutes.keys()) {
    assert.ok(key.includes("/apply/"), `apply_v1 has non-apply route: ${key}`);
  }
});

test("consent helper: absent, invalid, and recorded states", () => {
  const { dir, settingsPath } = createTempSettingsPath();

  try {
    assert.equal(hasApplyAutomationConsent(settingsPath), false);

    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ applyAutomationConsent: { acceptedAt: "not-a-date" } })
    );
    assert.equal(hasApplyAutomationConsent(settingsPath), false);

    const recorded = recordApplyAutomationConsent({ settingsPath });
    assert.ok(recorded.acceptedAt);
    assert.equal(hasApplyAutomationConsent(settingsPath), true);

    const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.equal(
      persisted.applyAutomationConsent.acceptedAt,
      recorded.acceptedAt
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recordApplyAutomationConsent preserves unrelated settings", () => {
  const { dir, settingsPath } = createTempSettingsPath();

  try {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ analytics: { enabled: false } })
    );
    recordApplyAutomationConsent({ settingsPath });

    const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.equal(persisted.analytics.enabled, false);
    assert.equal(hasApplyAutomationConsent(settingsPath), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("apply routes 403 without consent and work with it (noop provider, live server)", async () => {
  const { dir, settingsPath } = createTempSettingsPath();
  const { server, port } = await startBrowserBridgeServer({
    port: 0,
    providerName: "noop",
    settingsPath
  });
  const boundPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${boundPort}`;

  try {
    // Without consent: every apply route refuses with 403.
    for (const route of [
      "/apply/extract-form-schema",
      "/apply/type-text",
      "/apply/upload-file"
    ]) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      assert.equal(response.status, 403, `${route} should 403 sans consent`);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.match(payload.error, /consent/i);
    }

    // Read surface (mcp_v1 health) is unaffected by missing consent.
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);

    // Grant consent mid-session: takes effect without restart.
    recordApplyAutomationConsent({ settingsPath });

    const schemaResponse = await fetch(`${baseUrl}/apply/extract-form-schema`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://boards.greenhouse.io/x/jobs/1" })
    });
    assert.equal(schemaResponse.status, 200);
    const schemaPayload = await schemaResponse.json();
    assert.equal(schemaPayload.ok, true);
    assert.equal(schemaPayload.result.fields.length, 1);

    const typeResponse = await fetch(`${baseUrl}/apply/type-text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fieldId: "first_name", value: "Peter" })
    });
    assert.equal(typeResponse.status, 200);
    const typePayload = await typeResponse.json();
    assert.equal(typePayload.result.filled, true);
    assert.equal(typePayload.result.valueLength, 5);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.ok(port !== undefined);
});

test("providers without apply capabilities yield 501, not 500", async () => {
  const { dir, settingsPath } = createTempSettingsPath();
  recordApplyAutomationConsent({ settingsPath });

  const { server } = await startBrowserBridgeServer({
    port: 0,
    providerName: "persistent_scaffold",
    settingsPath
  });
  const boundPort = server.address().port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${boundPort}/apply/type-text`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fieldId: "x", value: "y" })
      }
    );
    assert.equal(response.status, 501);
    const payload = await response.json();
    assert.match(payload.error, /does not support apply operation/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
