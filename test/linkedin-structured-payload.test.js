import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  extractLinkedInStructuredPageFromResponseBody,
  extractLinkedInStructuredJobsFromResponseBody,
  extractLinkedInStructuredJobsFromHtml,
  listLinkedInStructuredPayloadRequests
} from "../src/sources/linkedin-structured-payload.js";

const SAMPLE_PATH = "/Users/admin/job-finder/data/li-sample-data.html";

test("sample LinkedIn HTML exposes voyager job payload requests", () => {
  const html = fs.readFileSync(SAMPLE_PATH, "utf8");
  const requests = listLinkedInStructuredPayloadRequests(html);

  assert.ok(
    requests.some((request) => request.includes("voyagerJobsDashJobPostings")),
    "expected structured job-posting request to be present"
  );
  assert.ok(
    requests.some((request) => request.includes("voyagerJobsDashJobPostingDetailSections")),
    "expected structured detail-sections request to be present"
  );
});

test("extractLinkedInStructuredJobsFromHtml parses MVP job fields from hidden payloads", () => {
  const html = fs.readFileSync(SAMPLE_PATH, "utf8");
  const jobs = extractLinkedInStructuredJobsFromHtml(html);

  assert.ok(jobs.length >= 1, "expected at least one structured LinkedIn job");

  const sampleJob = jobs.find((job) => job.externalId === "4392864954");
  assert.ok(sampleJob, "expected selected job to be extracted from structured payload");
  assert.equal(sampleJob.title, "Senior Product Manager - Data Experience");
  assert.equal(sampleJob.company, "RemoteHunter");
  assert.equal(sampleJob.location, "United States");
  assert.equal(sampleJob.postedAt, "8 hours ago");
  assert.equal(sampleJob.workplaceType, "REMOTE");
  assert.equal(sampleJob.url, "https://www.linkedin.com/jobs/view/4392864954/");
  assert.match(sampleJob.summary, /Senior Product Manager - Data Experience/);
});

test("extractLinkedInStructuredJobsFromHtml parses multiple jobs from a hidden job-cards collection payload", () => {
  const html = `
    <code style="display: none" id="bpr-guid-1">
      {&quot;data&quot;:{&quot;elements&quot;:[
        {&quot;$type&quot;:&quot;com.linkedin.voyager.dash.jobs.JobPostingCard&quot;,&quot;*jobPosting&quot;:&quot;urn:li:fsd_jobPosting:111&quot;,&quot;jobPostingTitle&quot;:&quot;Staff Product Manager&quot;,&quot;primaryDescription&quot;:{&quot;text&quot;:&quot;Plaid&quot;},&quot;tertiaryDescription&quot;:{&quot;text&quot;:&quot;San Francisco, CA · 1 day ago&quot;,&quot;attributesV2&quot;:[{&quot;start&quot;:18,&quot;length&quot;:9,&quot;detailData&quot;:{&quot;epoch&quot;:{&quot;type&quot;:&quot;TIME_AGO&quot;}}}]}}
        ,{&quot;$type&quot;:&quot;com.linkedin.voyager.dash.jobs.JobPostingCard&quot;,&quot;*jobPosting&quot;:&quot;urn:li:fsd_jobPosting:222&quot;,&quot;jobPostingTitle&quot;:&quot;Principal Product Manager&quot;,&quot;primaryDescription&quot;:{&quot;text&quot;:&quot;Figma&quot;},&quot;tertiaryDescription&quot;:{&quot;text&quot;:&quot;New York, NY · 3 days ago&quot;,&quot;attributesV2&quot;:[{&quot;start&quot;:16,&quot;length&quot;:10,&quot;detailData&quot;:{&quot;epoch&quot;:{&quot;type&quot;:&quot;TIME_AGO&quot;}}}]}}
      ]}}
    </code>
    <code style="display: none" id="datalet-bpr-guid-1">
      {"request":"/voyager/api/voyagerJobsDashJobCards?start=0","status":200,"body":"bpr-guid-1","method":"GET"}
    </code>
  `;

  const jobs = extractLinkedInStructuredJobsFromHtml(html);
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map((job) => ({
      externalId: job.externalId,
      title: job.title,
      company: job.company,
      location: job.location,
      postedAt: job.postedAt,
      url: job.url
    })),
    [
      {
        externalId: "111",
        title: "Staff Product Manager",
        company: "Plaid",
        location: "San Francisco, CA",
        postedAt: "1 day ago",
        url: "https://www.linkedin.com/jobs/view/111/"
      },
      {
        externalId: "222",
        title: "Principal Product Manager",
        company: "Figma",
        location: "New York, NY",
        postedAt: "3 days ago",
        url: "https://www.linkedin.com/jobs/view/222/"
      }
    ]
  );
});

test("extractLinkedInStructuredJobsFromResponseBody parses jobs from a raw voyager job-cards response", () => {
  const responseBody = {
    data: {
      elements: [
        {
          $type: "com.linkedin.voyager.dash.jobs.JobPostingCard",
          "*jobPosting": "urn:li:fsd_jobPosting:111",
          jobPostingTitle: "Staff Product Manager",
          primaryDescription: { text: "Plaid" },
          tertiaryDescription: {
            text: "San Francisco, CA · 1 day ago",
            attributesV2: [
              {
                start: 18,
                length: 9,
                detailData: { epoch: { type: "TIME_AGO" } }
              }
            ]
          }
        },
        {
          $type: "com.linkedin.voyager.dash.jobs.JobPostingCard",
          "*jobPosting": "urn:li:fsd_jobPosting:222",
          jobPostingTitle: "Principal Product Manager",
          primaryDescription: { text: "Figma" },
          tertiaryDescription: {
            text: "New York, NY · 3 days ago",
            attributesV2: [
              {
                start: 16,
                length: 10,
                detailData: { epoch: { type: "TIME_AGO" } }
              }
            ]
          }
        },
        {
          $type: "com.linkedin.voyager.dash.jobs.WorkplaceType",
          workplaceTypeEnum: "REMOTE"
        }
      ]
    }
  };

  const jobs = extractLinkedInStructuredJobsFromResponseBody(responseBody);
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map((job) => ({
      externalId: job.externalId,
      title: job.title,
      company: job.company,
      location: job.location,
      postedAt: job.postedAt,
      workplaceType: job.workplaceType,
      url: job.url
    })),
    [
      {
        externalId: "111",
        title: "Staff Product Manager",
        company: "Plaid",
        location: "San Francisco, CA",
        postedAt: "1 day ago",
        workplaceType: "REMOTE",
        url: "https://www.linkedin.com/jobs/view/111/"
      },
      {
        externalId: "222",
        title: "Principal Product Manager",
        company: "Figma",
        location: "New York, NY",
        postedAt: "3 days ago",
        workplaceType: "REMOTE",
        url: "https://www.linkedin.com/jobs/view/222/"
      }
    ]
  );
});

test("extractLinkedInStructuredJobsFromResponseBody parses normalized voyager job-cards recipe objects", () => {
  const responseBody = {
    metadata: {},
    elements: [
      {
        entityUrn: "urn:li:fsd_jobPostingCard:(4362113094,JOBS_SEARCH)",
        jobPostingUrn: "urn:li:fsd_jobPosting:4362113094",
        jobPostingTitle: "Product Manager",
        primaryDescription: { text: "Crossing Hurdles" },
        secondaryDescription: { text: "San Francisco, CA (On-site)" },
        tertiaryDescription: { text: "$150K/yr - $220K/yr" },
        footerItems: [
          { type: "PROMOTED" },
          { type: "LISTED_DATE", timeAt: Date.now() - 6 * 60 * 60 * 1000 }
        ]
      },
      {
        entityUrn: "urn:li:fsd_jobPostingCard:(4392400386,JOBS_SEARCH)",
        jobPostingUrn: "urn:li:fsd_jobPosting:4392400386",
        jobPostingTitle: "Product Manager",
        primaryDescription: { text: "Passive" },
        secondaryDescription: { text: "San Francisco Bay Area (Remote)" },
        tertiaryDescription: { text: "Up to $300K/yr + Stock options" },
        footerItems: [
          { type: "LISTED_DATE", timeAt: Date.now() - 2 * 24 * 60 * 60 * 1000 }
        ]
      }
    ],
    paging: {}
  };

  const jobs = extractLinkedInStructuredJobsFromResponseBody(responseBody);
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map((job) => ({
      externalId: job.externalId,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url
    })),
    [
      {
        externalId: "4362113094",
        title: "Product Manager",
        company: "Crossing Hurdles",
        location: "San Francisco, CA (On-site)",
        url: "https://www.linkedin.com/jobs/view/4362113094/"
      },
      {
        externalId: "4392400386",
        title: "Product Manager",
        company: "Passive",
        location: "San Francisco Bay Area (Remote)",
        url: "https://www.linkedin.com/jobs/view/4392400386/"
      }
    ]
  );
  assert.match(jobs[0].postedAt, /hours? ago|days? ago/);
  assert.match(jobs[1].postedAt, /days? ago/);
});

test("extractLinkedInStructuredPageFromResponseBody returns jobs plus paging metadata", () => {
  const page = extractLinkedInStructuredPageFromResponseBody({
    elements: [
      {
        entityUrn: "urn:li:fsd_jobPostingCard:(4324040699,JOBS_SEARCH)",
        jobPostingUrn: "urn:li:fsd_jobPosting:4324040699",
        jobPostingTitle: "Senior Product Manager",
        primaryDescription: { text: "Kikoff" },
        secondaryDescription: { text: "San Francisco, CA (Hybrid)" },
        footerItems: [{ type: "LISTED_DATE", timeAt: Date.now() - 48 * 60 * 60 * 1000 }]
      }
    ],
    paging: {
      start: 25,
      count: 25,
      total: 68
    }
  });

  assert.equal(page.jobs.length, 1);
  assert.equal(page.jobs[0].externalId, "4324040699");
  assert.deepEqual(page.paging, {
    start: 25,
    count: 25,
    total: 68
  });
});
