import test from "node:test";
import assert from "node:assert/strict";

import { authProbeLooksUnauthorized as authProbeLooksUnauthorizedChrome } from "../src/browser-bridge/providers/chrome-applescript.js";
import { authProbeLooksUnauthorizedForSource as authProbeLooksUnauthorizedPlaywright } from "../src/browser-bridge/providers/playwright-cli.js";

test("YC auth probe recognizes signed-in workatastartup page as authorized", () => {
  const probe = {
    href: "https://www.workatastartup.com/jobs",
    host: "www.workatastartup.com",
    pathname: "/jobs",
    title: "YC Jobs",
    hasPasswordField: false,
    textSnippet: "Companies & jobs Inbox Education My profile Peter"
  };

  assert.equal(authProbeLooksUnauthorizedChrome("yc_jobs", probe), false);
  assert.equal(authProbeLooksUnauthorizedPlaywright("yc_jobs", probe), false);
});

test("YC auth probe recognizes sign-in page as unauthorized", () => {
  const probe = {
    href: "https://www.workatastartup.com/sign_in",
    host: "www.workatastartup.com",
    pathname: "/sign_in",
    title: "Sign in to Work at a Startup",
    hasPasswordField: true,
    textSnippet: "Sign in Continue with Google"
  };

  assert.equal(authProbeLooksUnauthorizedChrome("yc_jobs", probe), true);
  assert.equal(authProbeLooksUnauthorizedPlaywright("yc_jobs", probe), true);
});
