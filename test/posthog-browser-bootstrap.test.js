import test from "node:test";
import assert from "node:assert/strict";

import { injectPosthogBrowserBootstrap } from "../src/review/posthog-browser-bootstrap.js";

test("injectPosthogBrowserBootstrap injects public PostHog config into review HTML", () => {
  const html = [
    "<!doctype html>",
    "<html>",
    "  <head>",
    "    <title>Job Finder</title>",
    "  </head>",
    "  <body>",
    "    <div id=\"root\"></div>",
    "  </body>",
    "</html>"
  ].join("\n");

  const output = injectPosthogBrowserBootstrap(html, {
    apiKey: "phc_public",
    host: "https://us.i.posthog.com"
  });

  assert.match(output, /window\.__JOB_FINDER_POSTHOG__=/);
  assert.match(output, /"apiKey":"phc_public"/);
  assert.match(output, /"host":"https:\/\/us\.i\.posthog\.com"/);
  assert.match(output, /<script>window\.__JOB_FINDER_POSTHOG__/);
  assert.ok(output.indexOf("</script>") < output.indexOf("</head>"));
});

test("injectPosthogBrowserBootstrap leaves HTML unchanged without a public token", () => {
  const html = "<html><head></head><body></body></html>";
  assert.equal(
    injectPosthogBrowserBootstrap(html, { apiKey: "", host: "https://us.i.posthog.com" }),
    html
  );
});
