import test from "node:test";
import assert from "node:assert/strict";

import { parseYcJobsHtml } from "../src/sources/yc-jobs.js";

test("parseYcJobsHtml extracts YC jobs and drops off-target roles from the product-manager route", () => {
  const html = `
    <html>
      <body>
        <div
          data-page="{&quot;component&quot;:&quot;JobsPage&quot;,&quot;props&quot;:{&quot;jobs&quot;:[{&quot;id&quot;:101,&quot;title&quot;:&quot;Founding Product Manager&quot;,&quot;companyName&quot;:&quot;Metriport&quot;,&quot;companySlug&quot;:&quot;metriport&quot;,&quot;location&quot;:&quot;San Francisco, CA&quot;,&quot;jobType&quot;:&quot;Full-time&quot;,&quot;roleType&quot;:&quot;Product&quot;,&quot;companyBatch&quot;:&quot;W23&quot;,&quot;companyOneLiner&quot;:&quot;Healthcare infrastructure APIs&quot;,&quot;applyUrl&quot;:&quot;https://account.ycombinator.com/authenticate?signup_job_id=101&quot;},{&quot;id&quot;:202,&quot;title&quot;:&quot;Product Designer&quot;,&quot;companyName&quot;:&quot;DesignCo&quot;,&quot;companySlug&quot;:&quot;designco&quot;,&quot;location&quot;:&quot;Remote&quot;,&quot;jobType&quot;:&quot;Full-time&quot;,&quot;roleType&quot;:&quot;Design&quot;,&quot;companyBatch&quot;:&quot;S22&quot;,&quot;companyOneLiner&quot;:&quot;Design tools&quot;,&quot;applyUrl&quot;:&quot;https://account.ycombinator.com/authenticate?signup_job_id=202&quot;}]}}"
        ></div>
      </body>
    </html>
  `;

  const jobs = parseYcJobsHtml(
    html,
    "https://www.workatastartup.com/jobs/l/product-manager"
  );

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, "101");
  assert.equal(jobs[0].title, "Founding Product Manager");
  assert.equal(jobs[0].company, "Metriport");
  assert.equal(
    jobs[0].url,
    "https://www.workatastartup.com/jobs/101"
  );
  assert.match(jobs[0].summary, /Healthcare infrastructure APIs/i);
  assert.equal(jobs[0].employmentType, "Full-time");
  assert.equal(jobs[0].location, "San Francisco, CA");
});

test("parseYcJobsHtml returns an empty list when the page payload is missing", () => {
  const jobs = parseYcJobsHtml(
    "<html><body><h1>No YC payload</h1></body></html>",
    "https://www.workatastartup.com/jobs/l/product-manager"
  );

  assert.deepEqual(jobs, []);
});

test("parseYcJobsHtml honors explicit browser search state instead of relying only on the route", () => {
  const html = `
    <html>
      <body>
        <div
          data-page="{&quot;component&quot;:&quot;JobsPage&quot;,&quot;props&quot;:{&quot;jobs&quot;:[{&quot;id&quot;:301,&quot;title&quot;:&quot;Founding Product Manager&quot;,&quot;companyName&quot;:&quot;AgentCo&quot;,&quot;companySlug&quot;:&quot;agentco&quot;,&quot;location&quot;:&quot;San Francisco, CA&quot;,&quot;jobType&quot;:&quot;Full-time&quot;,&quot;roleType&quot;:&quot;Product&quot;,&quot;companyBatch&quot;:&quot;W24&quot;,&quot;companyOneLiner&quot;:&quot;AI agents for support&quot;,&quot;applyUrl&quot;:&quot;https://account.ycombinator.com/authenticate?signup_job_id=301&quot;},{&quot;id&quot;:302,&quot;title&quot;:&quot;Founding Product Manager&quot;,&quot;companyName&quot;:&quot;FlowOps&quot;,&quot;companySlug&quot;:&quot;flowops&quot;,&quot;location&quot;:&quot;San Francisco, CA&quot;,&quot;jobType&quot;:&quot;Full-time&quot;,&quot;roleType&quot;:&quot;Product&quot;,&quot;companyBatch&quot;:&quot;S24&quot;,&quot;companyOneLiner&quot;:&quot;Workflow software&quot;,&quot;applyUrl&quot;:&quot;https://account.ycombinator.com/authenticate?signup_job_id=302&quot;},{&quot;id&quot;:303,&quot;title&quot;:&quot;Founding Engineer&quot;,&quot;companyName&quot;:&quot;BuilderCo&quot;,&quot;companySlug&quot;:&quot;builderco&quot;,&quot;location&quot;:&quot;San Francisco, CA&quot;,&quot;jobType&quot;:&quot;Full-time&quot;,&quot;roleType&quot;:&quot;Engineering&quot;,&quot;companyBatch&quot;:&quot;S24&quot;,&quot;companyOneLiner&quot;:&quot;AI infrastructure&quot;,&quot;applyUrl&quot;:&quot;https://account.ycombinator.com/authenticate?signup_job_id=303&quot;}]}}"
        ></div>
      </body>
    </html>
  `;

  const jobs = parseYcJobsHtml(html, {
    searchUrl: "https://www.workatastartup.com/jobs",
    criteria: {
      title: "Product manager",
      hardIncludeTerms: ["ai"],
      location: "San Francisco, CA"
    }
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, "301");
  assert.equal(jobs[0].title, "Founding Product Manager");
});
