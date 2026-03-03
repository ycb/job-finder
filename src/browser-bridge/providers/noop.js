export function captureLinkedInSourceWithNoop(source, snapshotPath) {
  throw new Error(
    [
      `No browser bridge provider is configured for "${source?.name || "unknown source"}".`,
      "Start the bridge server with provider=playwright_cli or implement a persistent browser provider.",
      `Requested snapshot path: ${snapshotPath}`
    ].join(" ")
  );
}
