import test from "node:test";
import assert from "node:assert/strict";

import {
  BRIDGE_PRIMITIVE_CLASS,
  BRIDGE_PRIMITIVE_ID,
  ensureBridgePrimitiveCatalogIntegrity,
  getBridgePrimitiveById,
  listBridgePrimitives,
  validatePrimitiveSurfaceRegistration
} from "../src/browser-bridge/primitives.js";
import {
  buildBridgeRouteDefinitions,
  buildBridgeRouteMap
} from "../src/browser-bridge/server.js";

test("bridge primitive catalog stays valid and classified", () => {
  assert.doesNotThrow(() => ensureBridgePrimitiveCatalogIntegrity());

  const primitives = listBridgePrimitives();
  assert.ok(primitives.length > 0);

  for (const primitive of primitives) {
    assert.ok(primitive.id);
    assert.ok(
      primitive.primitiveClass === BRIDGE_PRIMITIVE_CLASS.READ ||
        primitive.primitiveClass === BRIDGE_PRIMITIVE_CLASS.WRITE
    );
  }
});

test("mcp_v1 registration allows read primitives", () => {
  assert.doesNotThrow(() =>
    validatePrimitiveSurfaceRegistration({
      surface: "mcp_v1",
      primitiveIds: [
        BRIDGE_PRIMITIVE_ID.HEALTH_CHECK,
        BRIDGE_PRIMITIVE_ID.CAPTURE_SOURCE
      ]
    })
  );
});

test("mcp_v1 registration rejects write primitives", () => {
  assert.throws(
    () =>
      validatePrimitiveSurfaceRegistration({
        surface: "mcp_v1",
        primitiveIds: [
          BRIDGE_PRIMITIVE_ID.CAPTURE_SOURCE,
          BRIDGE_PRIMITIVE_ID.APPLY_CLICK
        ]
      }),
    /cannot expose write primitives/i
  );
});

test("bridge route registration is read-only for mcp_v1", () => {
  const provider = {
    name: "noop",
    captureSource() {
      return { status: "completed" };
    }
  };

  const routeDefinitions = buildBridgeRouteDefinitions(provider);
  assert.deepEqual(
    routeDefinitions.map((route) => route.primitiveId),
    [
      BRIDGE_PRIMITIVE_ID.HEALTH_CHECK,
      BRIDGE_PRIMITIVE_ID.CAPTURE_SOURCE,
      BRIDGE_PRIMITIVE_ID.CAPTURE_LINKEDIN_SOURCE
    ]
  );

  assert.equal(
    getBridgePrimitiveById(BRIDGE_PRIMITIVE_ID.CAPTURE_SOURCE)?.primitiveClass,
    BRIDGE_PRIMITIVE_CLASS.READ
  );

  const routeMap = buildBridgeRouteMap(provider, { surface: "mcp_v1" });
  assert.equal(routeMap.has("GET /health"), true);
  assert.equal(routeMap.has("POST /capture-source"), true);
  assert.equal(routeMap.has("POST /capture-linkedin-source"), true);
});
