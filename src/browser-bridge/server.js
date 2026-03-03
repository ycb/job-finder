import http from "node:http";

import { captureLinkedInSourceWithNoop } from "./providers/noop.js";
import { captureLinkedInSourceWithPlaywrightCli } from "./providers/playwright-cli.js";

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

function resolveProvider(providerName = "noop") {
  if (providerName === "playwright_cli") {
    return {
      name: providerName,
      captureLinkedInSource: captureLinkedInSourceWithPlaywrightCli
    };
  }

  return {
    name: "noop",
    captureLinkedInSource: captureLinkedInSourceWithNoop
  };
}

export async function startBrowserBridgeServer({
  port = 4315,
  providerName = process.env.JOB_FINDER_BRIDGE_PROVIDER || "noop"
} = {}) {
  const provider = resolveProvider(providerName);

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        createJsonResponse(response, 200, {
          ok: true,
          provider: provider.name
        });
        return;
      }

      if (request.method === "POST" && request.url === "/capture-linkedin-source") {
        const body = await readRequestBody(request);
        const result = provider.captureLinkedInSource(
          body.source,
          body.snapshotPath,
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
