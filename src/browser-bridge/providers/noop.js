export function captureSourceWithNoop(source, snapshotPath) {
  throw new Error(
    [
      `No browser bridge provider is configured for "${source?.name || "unknown source"}".`,
      "Start the bridge server with provider=playwright_cli or implement a persistent browser provider.",
      `Requested snapshot path: ${snapshotPath}`
    ].join(" ")
  );
}

export function captureLinkedInSourceWithNoop(source, snapshotPath) {
  return captureSourceWithNoop(source, snapshotPath);
}

export function probeSourceAccessWithNoop(source) {
  throw new Error(
    [
      `No browser bridge provider is configured for "${source?.name || "unknown source"}".`,
      "Start the bridge server with provider=chrome_applescript or provider=playwright_cli.",
      "Auth checks require an active browser bridge provider."
    ].join(" ")
  );
}

// Apply-surface (apply_v1) noop implementations. These return deterministic
// canned payloads so the HTTP surface, consent gating, and route wiring can
// be tested without a real browser. Real fills use chrome_applescript or
// playwright_cli providers.
export function extractApplyFormSchemaWithNoop({ url } = {}) {
  return {
    url: String(url || ""),
    adapter: "noop",
    fields: [
      {
        fieldId: "first_name",
        label: "First name",
        type: "text",
        required: true,
        options: null,
        sectionLabel: null
      }
    ]
  };
}

export function applyTypeTextWithNoop({ fieldId, value } = {}) {
  return {
    filled: true,
    fieldId: String(fieldId || ""),
    valueLength: String(value ?? "").length
  };
}

export function applyUploadFileWithNoop({ fieldId, filePath } = {}) {
  return {
    uploaded: true,
    fieldId: String(fieldId || ""),
    filePath: String(filePath || "")
  };
}
