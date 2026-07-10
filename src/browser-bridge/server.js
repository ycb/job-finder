import http from "node:http";

import { hasApplyAutomationConsent } from "../apply/consent.js";
import { captureSourceWithChromeAppleScript } from "./providers/chrome-applescript.js";
import { captureSourceWithNoop } from "./providers/noop.js";
import { captureSourceWithPersistentScaffold } from "./providers/persistent-scaffold.js";
import { captureSourceWithPlaywrightCli } from "./providers/playwright-cli.js";
import {
  BRIDGE_PRIMITIVE_ID,
  BRIDGE_SURFACE,
  ensureBridgePrimitiveCatalogIntegrity,
  validatePrimitiveSurfaceRegistration
} from "./primitives.js";
import {
  applyTypeTextWithChromeAppleScript,
  applyUploadFileWithChromeAppleScript,
  extractApplyFormSchemaWithChromeAppleScript,
  probeSourceAccessWithChromeAppleScript
} from "./providers/chrome-applescript.js";
import {
  applyTypeTextWithNoop,
  applyUploadFileWithNoop,
  extractApplyFormSchemaWithNoop,
  probeSourceAccessWithNoop
} from "./providers/noop.js";
import { probeSourceAccessWithPersistentScaffold } from "./providers/persistent-scaffold.js";
import { probeSourceAccessWithPlaywrightCli } from "./providers/playwright-cli.js";

function createJsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error("Request body too large."));
      }
    });

    request.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });

    request.on("error", reject);
  });
}

function createRouteKey(method, pathName) {
  return `${String(method || "GET").toUpperCase()} ${String(pathName || "/")}`;
}

function resolveRequestPath(requestUrl) {
  try {
    return new URL(String(requestUrl || "/"), "http://127.0.0.1").pathname;
  } catch {
    return String(requestUrl || "/");
  }
}

function resolveProvider(providerName = "noop") {
  if (providerName === "chrome_applescript") {
    return {
      name: providerName,
      captureSource: captureSourceWithChromeAppleScript,
      probeSourceAccess: probeSourceAccessWithChromeAppleScript,
      extractApplyFormSchema: extractApplyFormSchemaWithChromeAppleScript,
      applyTypeText: applyTypeTextWithChromeAppleScript,
      applyUploadFile: applyUploadFileWithChromeAppleScript
    };
  }

  if (providerName === "persistent_scaffold") {
    return {
      name: providerName,
      captureSource: captureSourceWithPersistentScaffold,
      probeSourceAccess: probeSourceAccessWithPersistentScaffold
    };
  }

  if (providerName === "playwright_cli") {
    return {
      name: providerName,
      captureSource: captureSourceWithPlaywrightCli,
      probeSourceAccess: probeSourceAccessWithPlaywrightCli
    };
  }

  return {
    name: "noop",
    captureSource: captureSourceWithNoop,
    probeSourceAccess: probeSourceAccessWithNoop,
    extractApplyFormSchema: extractApplyFormSchemaWithNoop,
    applyTypeText: applyTypeTextWithNoop,
    applyUploadFile: applyUploadFileWithNoop
  };
}

function requireApplyProviderCapability(provider, methodName) {
  if (typeof provider?.[methodName] !== "function") {
    const error = new Error(
      `Provider "${provider?.name || "unknown"}" does not support apply operation "${methodName}".`
    );
    error.statusCode = 501;
    throw error;
  }

  return provider[methodName];
}

// Every apply_v1 route is gated on explicit, recorded user consent — even the
// read-only schema extraction, because it opens a window in the user's
// browser. Consent is re-read per request so granting it mid-session takes
// effect without a bridge restart.
function assertApplyAutomationConsent(settingsPath) {
  if (hasApplyAutomationConsent(settingsPath)) {
    return;
  }

  const error = new Error(
    "Apply automation requires consent. Accept the apply-automation consent in the dashboard (stored as applyAutomationConsent.acceptedAt in data/user-settings.json) before using /apply routes."
  );
  error.statusCode = 403;
  throw error;
}

export function buildBridgeRouteDefinitions(provider) {
  return [
    {
      method: "GET",
      path: "/health",
      primitiveId: BRIDGE_PRIMITIVE_ID.HEALTH_CHECK,
      handle() {
        return {
          ok: true,
          provider: provider.name
        };
      }
    },
    {
      method: "POST",
      path: "/capture-source",
      primitiveId: BRIDGE_PRIMITIVE_ID.CAPTURE_SOURCE,
      async handle(request) {
        const body = await readRequestBody(request);
        const result = provider.captureSource(
          body.source,
          body.snapshotPath,
          body.options || {}
        );

        return {
          ok: true,
          provider: provider.name,
          result
        };
      }
    },
    {
      method: "POST",
      path: "/capture-linkedin-source",
      primitiveId: BRIDGE_PRIMITIVE_ID.CAPTURE_LINKEDIN_SOURCE,
      async handle(request) {
        const body = await readRequestBody(request);
        const result = provider.captureSource(
          body.source,
          body.snapshotPath,
          body.options || {}
        );

        return {
          ok: true,
          provider: provider.name,
          result
        };
      }
    }
  ];
}

export function buildApplyRouteDefinitions(provider, { settingsPath } = {}) {
  return [
    {
      method: "POST",
      path: "/apply/extract-form-schema",
      primitiveId: BRIDGE_PRIMITIVE_ID.FORM_EXTRACT_SCHEMA,
      async handle(request) {
        assertApplyAutomationConsent(settingsPath);
        const extract = requireApplyProviderCapability(
          provider,
          "extractApplyFormSchema"
        );
        const body = await readRequestBody(request);
        const result = await extract(body);

        return { ok: true, provider: provider.name, result };
      }
    },
    {
      method: "POST",
      path: "/apply/type-text",
      primitiveId: BRIDGE_PRIMITIVE_ID.FORM_TYPE_TEXT,
      async handle(request) {
        assertApplyAutomationConsent(settingsPath);
        const typeText = requireApplyProviderCapability(
          provider,
          "applyTypeText"
        );
        const body = await readRequestBody(request);
        const result = await typeText(body);

        return { ok: true, provider: provider.name, result };
      }
    },
    {
      method: "POST",
      path: "/apply/upload-file",
      primitiveId: BRIDGE_PRIMITIVE_ID.FORM_UPLOAD_FILE,
      async handle(request) {
        assertApplyAutomationConsent(settingsPath);
        const uploadFile = requireApplyProviderCapability(
          provider,
          "applyUploadFile"
        );
        const body = await readRequestBody(request);
        const result = await uploadFile(body);

        return { ok: true, provider: provider.name, result };
      }
    }
  ];
}

export function buildBridgeRouteMap(
  provider,
  { surface = "mcp_v1", settingsPath } = {}
) {
  ensureBridgePrimitiveCatalogIntegrity();
  const routeDefinitions =
    surface === BRIDGE_SURFACE.APPLY_V1
      ? buildApplyRouteDefinitions(provider, { settingsPath })
      : buildBridgeRouteDefinitions(provider);
  validatePrimitiveSurfaceRegistration({
    surface,
    primitiveIds: routeDefinitions.map((route) => route.primitiveId)
  });

  const routeMap = new Map();
  for (const route of routeDefinitions) {
    const key = createRouteKey(route.method, route.path);
    if (routeMap.has(key)) {
      throw new Error(`Duplicate bridge route registration for "${key}".`);
    }
    routeMap.set(key, route);
  }

  return routeMap;
}

export async function startBrowserBridgeServer({
  port = 4315,
  providerName = process.env.JOB_FINDER_BRIDGE_PROVIDER || "chrome_applescript",
  settingsPath
} = {}) {
  const provider = resolveProvider(providerName);
  const routeMap = buildBridgeRouteMap(provider, {
    surface: BRIDGE_SURFACE.MCP_V1
  });
  const applyRouteMap = buildBridgeRouteMap(provider, {
    surface: BRIDGE_SURFACE.APPLY_V1,
    settingsPath
  });
  for (const [key, route] of applyRouteMap) {
    if (routeMap.has(key)) {
      throw new Error(`Duplicate bridge route registration for "${key}".`);
    }
    routeMap.set(key, route);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const key = createRouteKey(
        request.method,
        resolveRequestPath(request.url)
      );
      const route = routeMap.get(key);

      if (route) {
        const payload = await route.handle(request, response);
        createJsonResponse(response, 200, payload);
        return;
      }

      if (request.method === "POST" && request.url === "/probe-source-access") {
        const body = await readRequestBody(request);
        const result = provider.probeSourceAccess(
          body.source,
          body.options || {}
        );

        createJsonResponse(response, 200, {
          ok: true,
          provider: provider.name,
          result
        });
        return;
      }

      createJsonResponse(response, 404, {
        ok: false,
        error: "Not found."
      });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode)
        ? error.statusCode
        : 500;
      createJsonResponse(response, statusCode, {
        ok: false,
        error: error.message
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    port,
    provider: provider.name
  };
}
