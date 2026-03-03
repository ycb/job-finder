import http from "node:http";

import { openDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import { listReviewQueue, markApplicationStatus } from "../jobs/repository.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
}

function withDatabase(work) {
  const { db } = openDatabase();
  runMigrations(db);

  try {
    return work(db);
  } finally {
    db.close();
  }
}

function getReviewQueue(limit = 100) {
  return withDatabase((db) => listReviewQueue(db, limit));
}

function updateStatus(jobId, status) {
  return withDatabase((db) => markApplicationStatus(db, jobId, status));
}

function buildLinkedInSearchUrl(job) {
  const query = [job.title, job.company].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    keywords: query
  });
  return `https://www.linkedin.com/jobs/search-results/?${params.toString()}`;
}

function resolveReviewTarget(job) {
  const sourceUrl = typeof job.sourceUrl === "string" ? job.sourceUrl : "";
  const externalId = typeof job.externalId === "string" ? job.externalId : "";

  if (sourceUrl.startsWith("https://www.linkedin.com/jobs/search-results/")) {
    return {
      url: sourceUrl,
      mode: "search"
    };
  }

  if (/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/?$/i.test(sourceUrl)) {
    return {
      url: sourceUrl,
      mode: "direct"
    };
  }

  if (/^\d+$/.test(externalId)) {
    return {
      url: `https://www.linkedin.com/jobs/view/${externalId}/`,
      mode: "direct"
    };
  }

  if (
    sourceUrl.startsWith("https://www.linkedin.com/jobs/view/") &&
    !/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/?$/i.test(sourceUrl)
  ) {
    return {
      url: buildLinkedInSearchUrl(job),
      mode: "search"
    };
  }

  return {
    url: sourceUrl || buildLinkedInSearchUrl(job),
    mode: sourceUrl ? "direct" : "search"
  };
}

function normalizeStatus(status) {
  if (status === "reviewed" || status === "drafted") {
    return "viewed";
  }

  if (status === "applied" || status === "rejected" || status === "viewed") {
    return status;
  }

  return "new";
}

function parseReasons(rawReasons) {
  if (typeof rawReasons !== "string" || rawReasons.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawReasons);
    return Array.isArray(parsed)
      ? parsed.filter((value) => typeof value === "string" && value.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function hydrateQueue(queue) {
  return queue.map((job) => ({
    ...job,
    status: normalizeStatus(job.status),
    reasons: parseReasons(job.reasons),
    reviewTarget: resolveReviewTarget(job)
  }));
}

function renderReviewPage(queue) {
  const queueJson = JSON.stringify(hydrateQueue(queue));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Job Finder Review</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e8;
        --panel: rgba(255, 252, 245, 0.94);
        --ink: #1e2a26;
        --muted: #5e6b66;
        --line: #d8cfbd;
        --high: #17643a;
        --review: #8a5a0a;
        --button: #1e2a26;
        --button-ink: #fdf9ef;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Georgia, "Iowan Old Style", serif;
        background:
          radial-gradient(circle at top right, rgba(210, 182, 126, 0.35), transparent 36%),
          linear-gradient(180deg, #f8f3e7 0%, #efe7d7 100%);
        color: var(--ink);
        min-height: 100vh;
      }

      .shell {
        max-width: 1240px;
        margin: 32px auto;
        padding: 0 20px 32px;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        box-shadow: 0 20px 40px rgba(52, 44, 29, 0.12);
        padding: 20px;
        backdrop-filter: blur(10px);
      }

      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 10px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 36px;
        line-height: 1.1;
      }

      .meta,
      .empty {
        color: var(--muted);
      }

      .meta {
        margin: 0 0 16px;
        font-size: 15px;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.95fr);
        gap: 22px;
      }

      .detail {
        min-width: 0;
      }

      .summary-card,
      .metadata-card,
      .queue-card {
        margin-top: 18px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.72);
        padding: 16px;
      }

      .section-label {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin: 0 0 10px;
      }

      .summary {
        margin: 0;
        line-height: 1.45;
        color: var(--ink);
      }

      .scoreline {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 16px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 8px 12px;
        border: 1px solid var(--line);
        font-size: 13px;
        background: rgba(255, 255, 255, 0.7);
      }

      .pill[data-bucket="high_signal"] {
        color: var(--high);
        border-color: rgba(23, 100, 58, 0.25);
      }

      .pill[data-bucket="review_later"] {
        color: var(--review);
        border-color: rgba(138, 90, 10, 0.25);
      }

      .metadata-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 16px;
      }

      .metadata-item dt {
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .metadata-item dd {
        margin: 4px 0 0;
        font-size: 15px;
      }

      .reason-list {
        margin: 0;
        padding-left: 18px;
        color: var(--ink);
      }

      .reason-list li + li {
        margin-top: 8px;
      }

      .actions,
      .status-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 18px;
      }

      button,
      a.button {
        appearance: none;
        border: 0;
        border-radius: 12px;
        padding: 11px 14px;
        font: inherit;
        font-size: 14px;
        text-decoration: none;
        cursor: pointer;
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      button.primary,
      a.button.primary {
        background: var(--button);
        color: var(--button-ink);
      }

      button.secondary,
      a.button.secondary {
        background: rgba(255, 255, 255, 0.82);
        color: var(--ink);
        border: 1px solid var(--line);
      }

      .status-row button {
        background: rgba(255, 255, 255, 0.82);
        border: 1px solid var(--line);
        color: var(--ink);
      }

      .status-row button.active {
        background: var(--button);
        border-color: var(--button);
        color: var(--button-ink);
      }

      .queue-card {
        margin-top: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      .queue-summary {
        color: var(--muted);
        color: var(--muted);
        font-size: 13px;
        margin: 0 0 14px;
      }

      .queue-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow: auto;
        max-height: 70vh;
        padding-right: 4px;
      }

      .queue-item {
        width: 100%;
        text-align: left;
        background: rgba(255, 255, 255, 0.82);
        color: var(--ink);
        border: 1px solid var(--line);
        padding: 14px;
        border-radius: 14px;
      }

      .queue-item.active {
        border-color: rgba(23, 100, 58, 0.35);
        box-shadow: inset 0 0 0 1px rgba(23, 100, 58, 0.18);
      }

      .queue-item-header {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
      }

      .queue-item-title {
        font-size: 16px;
        line-height: 1.3;
        font-weight: 700;
      }

      .queue-item-score {
        font-size: 13px;
        white-space: nowrap;
        color: var(--high);
      }

      .queue-item-meta {
        margin-top: 6px;
        font-size: 13px;
        color: var(--muted);
      }

      .queue-item-summary {
        margin-top: 8px;
        font-size: 13px;
        line-height: 1.4;
        color: var(--muted);
      }

      .footer {
        margin-top: 18px;
        color: var(--muted);
        font-size: 13px;
      }

      @media (max-width: 640px) {
        h1 {
          font-size: 26px;
        }

        .metadata-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 980px) {
        .layout {
          grid-template-columns: 1fr;
        }

        .queue-list {
          max-height: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="panel">
        <div class="eyebrow">Review Queue</div>
        <div id="app"></div>
      </div>
    </div>
    <script>
      const queue = ${queueJson};
      let index = 0;

      const app = document.getElementById("app");

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function currentJob() {
        return queue[index] || null;
      }

      function statusButton(label, status, currentStatus) {
        const activeClass = currentStatus === status ? "active" : "";
        return '<button class="' + activeClass + '" data-status="' + status + '">' + label + '</button>';
      }

      function formatBucket(bucket) {
        if (!bucket) {
          return "unscored";
        }

        return bucket.replaceAll("_", " ");
      }

      function formatValue(value, fallback) {
        if (typeof value === "string" && value.trim().length > 0) {
          return value;
        }

        return fallback;
      }

      function formatStatus(status) {
        if (status === "viewed") {
          return "viewed";
        }

        if (status === "applied") {
          return "applied";
        }

        if (status === "rejected") {
          return "rejected";
        }

        return "new";
      }

      function reviewLinkLabel(job) {
        return job.reviewTarget && job.reviewTarget.mode === "search" ? "Find on LinkedIn" : "Open Job";
      }

      function reviewLinkNote(job) {
        return job.reviewTarget && job.reviewTarget.mode === "search"
          ? "This job does not have an exact LinkedIn permalink in the capture yet. This opens a best-effort LinkedIn search."
          : "This opens the captured LinkedIn job page.";
      }

      function jumpTo(nextIndex, options = {}) {
        if (nextIndex < 0 || nextIndex >= queue.length) {
          return;
        }

        index = nextIndex;
        render();

        if (options.open) {
          openCurrent();
        }
      }

      function render() {
        const job = currentJob();

        if (!job) {
          app.innerHTML = '<p class="empty">No active jobs are currently in the queue. Run sync and score, or bring rejected jobs back by marking them new in the CLI.</p>';
          return;
        }

        const bucketLabel = formatBucket(job.bucket);
        const safeTitle = escapeHtml(job.title);
        const safeCompany = escapeHtml(job.company);
        const safeLocation = escapeHtml(formatValue(job.location, "Location unknown"));
        const safeSummary = escapeHtml(job.summary || "No summary available.");
        const safeStatus = escapeHtml(formatStatus(job.status));
        const safeSalary = escapeHtml(formatValue(job.salaryText, "Unknown"));
        const safeEmploymentType = escapeHtml(formatValue(job.employmentType, "Unknown"));
        const safePostedAt = escapeHtml(formatValue(job.postedAt, "Unknown"));
        const safeOpenLabel = escapeHtml(reviewLinkLabel(job));
        const safeLinkNote = escapeHtml(reviewLinkNote(job));
        const reasonItems =
          job.reasons && job.reasons.length > 0
            ? job.reasons
                .map((reason) => '<li>' + escapeHtml(reason) + '</li>')
                .join("")
            : '<li>No specific fit reasons recorded yet.</li>';
        const queueItems = queue
          .map((item, itemIndex) => {
            const activeClass = itemIndex === index ? " active" : "";
            return [
              '<button class="queue-item' + activeClass + '" data-index="' + itemIndex + '">',
              '  <div class="queue-item-header">',
              '    <span class="queue-item-title">' + escapeHtml(item.title) + '</span>',
              '    <span class="queue-item-score">Score ' + escapeHtml(item.score ?? "n/a") + '</span>',
              "  </div>",
              '  <div class="queue-item-meta">' +
                escapeHtml(formatValue(item.company, "Unknown company")) +
                " · " +
                escapeHtml(formatValue(item.location, "Location unknown")) +
                " · " +
                escapeHtml(formatBucket(item.bucket)) +
                " · " +
                escapeHtml(formatStatus(item.status)) +
                "</div>",
              '  <div class="queue-item-summary">' + escapeHtml(item.summary || "No summary available.") + "</div>",
              "</button>"
            ].join("");
          })
          .join("");

        app.innerHTML = [
          '<div class="layout">',
          '  <section class="detail">',
          '    <div class="eyebrow">Job ' + (index + 1) + ' of ' + queue.length + '</div>',
          '    <h1>' + safeTitle + '</h1>',
          '    <p class="meta">' + safeCompany + ' · ' + safeLocation + '</p>',
          '    <div class="scoreline">',
          '      <span class="pill" data-bucket="' + escapeHtml(job.bucket || "unscored") + '">Bucket: ' + escapeHtml(bucketLabel) + '</span>',
          '      <span class="pill">Score: ' + escapeHtml(job.score ?? "n/a") + '</span>',
          '      <span class="pill">Status: ' + safeStatus + '</span>',
          "    </div>",
          '    <div class="actions">',
          '      <button class="primary" id="open-current">' + safeOpenLabel + '</button>',
          '      <button class="secondary" id="prev-job"' + (index === 0 ? " disabled" : "") + ">Prev</button>",
          '      <button class="secondary" id="next-job"' + (index === queue.length - 1 ? " disabled" : "") + ">Next</button>",
          "    </div>",
          '    <div class="status-row">',
               statusButton("New", "new", safeStatus),
               statusButton("Viewed", "viewed", safeStatus),
               statusButton("I Applied", "applied", safeStatus),
               statusButton("Reject", "rejected", safeStatus),
          "    </div>",
          '    <div class="summary-card">',
          '      <p class="section-label">Why It Fits</p>',
          '      <p class="summary">' + safeSummary + '</p>',
          '      <ul class="reason-list">' + reasonItems + "</ul>",
          "    </div>",
          '    <div class="metadata-card">',
          '      <p class="section-label">Role Snapshot</p>',
          '      <dl class="metadata-grid">',
          '        <div class="metadata-item"><dt>Salary</dt><dd>' + safeSalary + "</dd></div>",
          '        <div class="metadata-item"><dt>Employment</dt><dd>' + safeEmploymentType + "</dd></div>",
          '        <div class="metadata-item"><dt>Posted</dt><dd>' + safePostedAt + "</dd></div>",
          '        <div class="metadata-item"><dt>Review Link</dt><dd><a href="' + encodeURI(job.reviewTarget.url) + '" target="job-review-target" rel="noreferrer">' + safeOpenLabel + '</a></dd></div>',
          "      </dl>",
          '      <p class="queue-summary" style="margin-top: 14px;">' + safeLinkNote + "</p>",
          "    </div>",
          '    <div class="footer">Reject removes the job from this active queue. We can add reject reasons for future scoring next.</div>',
          "  </section>",
          '  <aside class="queue-card">',
          '    <p class="section-label">Ranked Jobs</p>',
          '    <p class="queue-summary">All active jobs, sorted by score. Click any row to preview it here, then use Open Job to load LinkedIn.</p>',
          '    <div class="queue-list">' + queueItems + "</div>",
          "  </aside>",
          "</div>"
        ].join("");

        document.getElementById("open-current").addEventListener("click", () => openCurrent());
        document.getElementById("prev-job").addEventListener("click", () => jumpTo(index - 1));
        document.getElementById("next-job").addEventListener("click", () => jumpTo(index + 1));

        for (const button of document.querySelectorAll("[data-status]")) {
          button.addEventListener("click", async () => {
            await updateStatus(button.dataset.status);
          });
        }

        for (const button of document.querySelectorAll("[data-index]")) {
          button.addEventListener("click", () => {
            const nextIndex = Number(button.dataset.index);
            if (Number.isFinite(nextIndex)) {
              jumpTo(nextIndex);
            }
          });
        }
      }

      async function openCurrent() {
        const job = currentJob();
        if (!job) {
          return;
        }

        window.open(job.reviewTarget.url, "job-review-target");

        if (job.status === "new") {
          await updateStatus("viewed", { rerender: true });
        }
      }

      async function persistStatus(jobId, status) {
        let response;

        try {
          response = await fetch("/api/jobs/" + encodeURIComponent(jobId) + "/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
          });
        } catch {
          throw new Error("The local review server is offline. Restart it with 'npm run review' and reload this page.");
        }

        if (!response.ok) {
          throw new Error("The review server rejected the update. Reload the page and try again.");
        }
      }

      async function updateStatus(status, options = {}) {
        const job = currentJob();
        if (!job) {
          return;
        }

        try {
          await persistStatus(job.id, status);
        } catch (error) {
          alert(error.message);
          return;
        }

        if (status === "rejected") {
          queue.splice(index, 1);
          if (index >= queue.length) {
            index = Math.max(0, queue.length - 1);
          }
          render();
          return;
        }

        job.status = status;

        if (options.rerender !== false) {
          render();
        }
      }

      render();
    </script>
  </body>
</html>`;
}

export function startReviewServer({ port = 4311, limit = 100 } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

      if (request.method === "GET" && url.pathname === "/api/queue") {
        const queue = hydrateQueue(getReviewQueue(limit));
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ jobs: queue }));
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/jobs/")) {
        const match = url.pathname.match(/^\/api\/jobs\/([^/]+)\/status$/);
        if (!match) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const status = typeof parsedBody.status === "string" ? parsedBody.status.trim() : "";

        if (!status) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "status is required" }));
          return;
        }

        updateStatus(decodeURIComponent(match[1]), status);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        const queue = getReviewQueue(limit);
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderReviewPage(queue));
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.message);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}
