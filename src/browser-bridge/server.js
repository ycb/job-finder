import http from "node:http";

import { captureSourceWithChromeAppleScript } from "./providers/chrome-applescript.js";
import { captureSourceWithNoop } from "./providers/noop.js";
import { captureSourceWithPersistentScaffold } from "./providers/persistent-scaffold.js";
import { captureSourceWithPlaywrightCli } from "./providers/playwright-cli.js";
import {
  BRIDGE_PRIMITIVE_ID,
  ensureBridgePrimitiveCatalogIntegrity,
  validatePrimitiveSurfaceRegistration
} from "./primitives.js";
import { probeSourceAccessWithChromeAppleScript } from "./providers/chrome-applescript.js";
import { probeSourceAccessWithNoop } from "./providers/noop.js";
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
      probeSourceAccess: probeSourceAccessWithChromeAppleScript
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
    probeSourceAccess: probeSourceAccessWithNoop
  };
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

export function buildBridgeRouteMap(provider, { surface = "mcp_v1" } = {}) {
  ensureBridgePrimitiveCatalogIntegrity();
  const routeDefinitions = buildBridgeRouteDefinitions(provider);
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
  providerName = process.env.JOB_FINDER_BRIDGE_PROVIDER || "chrome_applescript"
} = {}) {
  const provider = resolveProvider(providerName);
  const routeMap = buildBridgeRouteMap(provider, { surface: "mcp_v1" });

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
      createJsonResponse(response, 500, {
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
