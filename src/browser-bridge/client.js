async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(text || `Unexpected bridge response: HTTP ${response.status}`);
  }

  return response.json();
}

export function resolveBrowserBridgeBaseUrl(overrideBaseUrl) {
  return String(
    overrideBaseUrl ||
      process.env.JOB_FINDER_BROWSER_BRIDGE_URL ||
      "http://127.0.0.1:4315"
  ).replace(/\/+$/, "");
}

export async function captureSourceViaBridge(
  source,
  snapshotPath,
  options = {}
) {
  const baseUrl = resolveBrowserBridgeBaseUrl(options.baseUrl);

  let response;
  try {
    response = await fetch(`${baseUrl}/capture-source`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        source,
        snapshotPath,
        options: {
          sessionName: options.sessionName,
          timeoutMs: options.timeoutMs,
          maxPages: options.maxPages,
          maxScrollSteps: options.maxScrollSteps,
          maxIdleScrollSteps: options.maxIdleScrollSteps,
          settleMs: options.settleMs,
          attemptDelayMs: options.attemptDelayMs,
          maxAttempts: options.maxAttempts
        }
      })
    });
  } catch (error) {
    throw new Error(
      `Browser bridge unavailable at ${baseUrl}. Start \`node src/cli.js bridge-server\` and try again. (${error.message})`
    );
  }

  const payload = await parseJsonResponse(response);

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Browser bridge request failed: HTTP ${response.status}`);
  }

  return payload.result;
}

export async function probeSourceAccessViaBridge(source, options = {}) {
  const baseUrl = resolveBrowserBridgeBaseUrl(options.baseUrl);

  let response;
  try {
    response = await fetch(`${baseUrl}/probe-source-access`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        source,
        options: {
          sessionName: options.sessionName,
          timeoutMs: options.timeoutMs,
          settleMs: options.settleMs,
          closeWindowAfterProbe: options.closeWindowAfterProbe
        }
      })
    });
  } catch (error) {
    throw new Error(
      `Browser bridge unavailable at ${baseUrl}. Start \`node src/cli.js bridge-server\` and try again. (${error.message})`
    );
  }

  const payload = await parseJsonResponse(response);

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Browser bridge request failed: HTTP ${response.status}`);
  }

  return payload.result;
}

export async function captureLinkedInSourceViaBridge(
  source,
  snapshotPath,
  options = {}
) {
  return captureSourceViaBridge(source, snapshotPath, options);
}
