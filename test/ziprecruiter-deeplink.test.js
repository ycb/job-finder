import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeJobRecord } from "../src/jobs/normalize.js";
import { resolveReviewTarget } from "../src/review/server.js";
import {
  collectZipRecruiterJobsFromSearch,
  writeZipRecruiterCaptureFile
} from "../src/sources/ziprecruiter-jobs.js";

function createTempZipSource() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-zip-deeplink-"));
  return {
    tempDir,
    source: {
      id: "zip-ai",
      name: "Zip AI",
      type: "ziprecruiter_search",
      searchUrl: "https://www.ziprecruiter.com/jobs-search?search=ai+product+manager",
      capturePath: path.join(tempDir, "zip-capture.json")
    }
  };
}

test("normalizeJobRecord preserves ziprecruiter lk deep links", () => {
  const source = {
    id: "zip-ai",
    type: "ziprecruiter_search",
    searchUrl: "https://www.ziprecruiter.com/jobs-search?search=ai+product+manager"
  };

  const normalized = normalizeJobRecord(
    {
      title: "Senior Product Manager",
      company: "Turo",
      location: "San Francisco, CA",
      description: "Role details",
      externalId: "",
      url: "https://www.ziprecruiter.com/co/Turo/Jobs/-in-San-Francisco,CA?lk=uZgxKlsLSca-m66Nl2T-WQ&radius=25"
    },
    source
  );

  assert.equal(normalized.externalId, "uZgxKlsLSca-m66Nl2T-WQ");
  assert.equal(
    normalized.sourceUrl,
    "https://www.ziprecruiter.com/co/Turo/Jobs/-in-San-Francisco,CA?lk=uZgxKlsLSca-m66Nl2T-WQ"
  );
});

test("normalizeJobRecord preserves ziprecruiter uuid deep links", () => {
  const source = {
    id: "zip-ai",
    type: "ziprecruiter_search",
    searchUrl: "https://www.ziprecruiter.com/jobs-search?search=ai+product+manager"
  };

  const normalized = normalizeJobRecord(
    {
      title: "Technical Product Manager",
      company: "enexusglobal",
      location: "Oakland, CA",
      description: "Role details",
      externalId: "",
      url: "https://www.ziprecruiter.com/co/enexusglobal/Jobs/-in-Oakland,CA?uuid=838tEK%2F6LOhcNHva5en%2F3zyXXm4%3D&radius=25"
    },
    source
  );

  assert.equal(normalized.externalId, "838tEK/6LOhcNHva5en/3zyXXm4=");
  assert.equal(
    normalized.sourceUrl,
    "https://www.ziprecruiter.com/co/enexusglobal/Jobs/-in-Oakland,CA?uuid=838tEK%2F6LOhcNHva5en%2F3zyXXm4%3D"
  );
});

test("writeZipRecruiterCaptureFile preserves job-specific query identity through capture readback", () => {
  const { tempDir, source } = createTempZipSource();

  try {
    writeZipRecruiterCaptureFile(
      source,
      [
        {
          title: "Product Manager",
          company: "Qode",
          location: "San Francisco, CA",
          externalId: "",
          url: "https://www.ziprecruiter.com/co/Qode/Jobs/-in-San-Francisco,CA?uuid=abc123%3D&radius=25"
        }
      ],
      {
        pageUrl: source.searchUrl
      }
    );

    const [job] = collectZipRecruiterJobsFromSearch(source);
    assert.equal(job.externalId, "abc123=");
    assert.equal(
      job.url,
      "https://www.ziprecruiter.com/co/Qode/Jobs/-in-San-Francisco,CA?uuid=abc123%3D"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveReviewTarget opens preserved ziprecruiter deep links directly", () => {
  const sourceById = new Map([
    ["zip-ai", { id: "zip-ai", type: "ziprecruiter_search" }]
  ]);

  const result = resolveReviewTarget(
    {
      sourceId: "zip-ai",
      source: "ziprecruiter_search",
      sourceUrl:
        "https://www.ziprecruiter.com/co/Turo/Jobs/-in-San-Francisco,CA?lk=uZgxKlsLSca-m66Nl2T-WQ",
      externalId: "uZgxKlsLSca-m66Nl2T-WQ"
    },
    { sourceById }
  );

  assert.deepEqual(result, {
    url: "https://www.ziprecruiter.com/co/Turo/Jobs/-in-San-Francisco,CA?lk=uZgxKlsLSca-m66Nl2T-WQ",
    mode: "direct"
  });
});
