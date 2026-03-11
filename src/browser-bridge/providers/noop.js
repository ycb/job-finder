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
