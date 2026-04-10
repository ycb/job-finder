export function injectPosthogBrowserBootstrap(html, config = {}) {
  const apiKey = String(config.apiKey || "").trim();
  if (!apiKey) {
    return html;
  }

  const payload = JSON.stringify({
    apiKey,
    host: String(config.host || "").trim()
  }).replace(/</g, "\\u003c");
  const script = `<script>window.__JOB_FINDER_POSTHOG__=${payload};</script>`;

  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${script}\n  </head>`);
  }

  return `${script}\n${html}`;
}
