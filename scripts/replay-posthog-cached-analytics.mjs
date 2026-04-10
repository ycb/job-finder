import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

process.loadEnvFile(".env");

const eventsPath = path.resolve(process.argv[2] || "data/analytics/events.jsonl");
const posthogHost = String(process.env.POSTHOG_HOST || "https://us.i.posthog.com")
  .trim()
  .replace(/\/+$/, "");
const posthogApiKey = String(process.env.POSTHOG_API_KEY || "").trim();

if (!posthogApiKey) {
  throw new Error("POSTHOG_API_KEY is missing.");
}

if (!fs.existsSync(eventsPath)) {
  throw new Error(`Analytics event file not found: ${eventsPath}`);
}

const envelopes = fs
  .readFileSync(eventsPath, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

let replayed = 0;
for (const envelope of envelopes) {
  const insertId = crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        envelope.occurredAt,
        envelope.distinctId,
        envelope.posthog?.event,
        envelope.properties
      ])
    )
    .digest("hex");

  const payload = {
    api_key: posthogApiKey,
    event: envelope.posthog.event,
    distinct_id: envelope.distinctId,
    properties: {
      ...envelope.posthog.properties,
      $insert_id: insertId
    },
    timestamp: envelope.occurredAt
  };

  const response = await fetch(`${posthogHost}/capture/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Replay failed for ${envelope.posthog.event} at ${envelope.occurredAt}: ${response.status} ${body}`
    );
  }

  replayed += 1;
}

console.log(
  JSON.stringify(
    {
      replayed,
      total: envelopes.length,
      posthogHost,
      eventsPath
    },
    null,
    2
  )
);
