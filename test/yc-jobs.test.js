import test from "node:test";
import assert from "node:assert/strict";

import {
  getYcRecencyFraction,
  resolveYcRecencyFraction,
  parseYcJobsHtml,
  parseYcJobsFromDomCards
} from "../src/sources/yc-jobs.js";

test("parseYcJobsHtml extracts YC jobs and drops off-target roles from the native companies query", () => {
  const html = `
    <html>
      <body>
        <div
          data-page="{&quot;component&quot;:&quot;JobsPage&quot;,&quot;props&quot;:{&quot;jobs&quot;:[{&quot;id&quot;:101,&quot;title&quot;:&quot;Founding Product Manager&quot;,&quot;companyName&quot;:&quot;Metriport&quot;,&quot;companySlug&quot;:&quot;metriport&quot;,&quot;location&quot;:&quot;San Francisco, CA&quot;,&quot;jobType&quot;:&quot;Full-time&quot;,&quot;roleType&quot;:&quot;Product&quot;,&quot;companyBatch&quot;:&quot;W23&quot;,&quot;companyOneLiner&quot;:&quot;AI healthcare infrastructure APIs&quot;,&quot;applyUrl&quot;:&quot;https://account.ycombinator.com/authenticate?signup_job_id=101&quot;},{&quot;id&quot;:202,&quot;title&quot;:&quot;Product Designer&quot;,&quot;companyName&quot;:&quot;DesignCo&quot;,&quot;companySlug&quot;:&quot;designco&quot;,&quot;location&quot;:&quot;Remote&quot;,&quot;jobType&quot;:&quot;Full-time&quot;,&quot;roleType&quot;:&quot;Design&quot;,&quot;companyBatch&quot;:&quot;S22&quot;,&quot;companyOneLiner&quot;:&quot;AI design tools&quot;,&quot;applyUrl&quot;:&quot;https://account.ycombinator.com/authenticate?signup_job_id=202&quot;}]}}"
        ></div>
      </body>
    </html>
  `;

  const jobs = parseYcJobsHtml(
    html,
    "https://www.workatastartup.com/companies?query=ai&role=product&sortBy=keyword&layout=list-compact"
  );

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, "101");
  assert.equal(jobs[0].title, "Founding Product Manager");
  assert.equal(jobs[0].company, "Metriport");
  assert.equal(
    jobs[0].url,
    "https://www.workatastartup.com/jobs/101"
  );
  assert.match(jobs[0].summary, /AI healthcare infrastructure APIs/i);
  assert.equal(jobs[0].employmentType, "Full-time");
  assert.equal(jobs[0].location, "San Francisco, CA");
});

test("parseYcJobsHtml returns an empty list when the page payload is missing", () => {
  const jobs = parseYcJobsHtml(
    "<html><body><h1>No YC payload</h1></body></html>",
    "https://www.workatastartup.com/companies?query=ai&role=product&sortBy=keyword&layout=list-compact"
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
    searchUrl: "https://www.workatastartup.com/companies?query=ai&role=product&sortBy=keyword&layout=list-compact",
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

test("parseYcJobsFromDomCards builds jobs from companies-page cards", () => {
  const cards = [
    {
      href: "https://www.workatastartup.com/jobs/89862",
      title: "Head of Product",
      company: "Conduit",
      companyUrl: "/companies/conduit",
      cardText: "Head of Product\nConduit\nSan Jose, CA, US\nFulltime\n$190K - $215K"
    },
    {
      href: "https://www.workatastartup.com/jobs/12345",
      title: "Product Designer",
      company: "DesignCo",
      companyUrl: "/companies/designco",
      cardText: "Product Designer\nDesignCo\nRemote\nFulltime"
    }
  ];

  const jobs = parseYcJobsFromDomCards(cards, {
    searchUrl:
      "https://www.workatastartup.com/companies?query=ai&role=product&sortBy=keyword&layout=list-compact",
    domCards: true,
    criteria: {
      title: "Product manager",
      hardIncludeTerms: ["ai"]
    }
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, "89862");
  assert.equal(jobs[0].company, "Conduit");
  assert.equal(jobs[0].employmentType, "Fulltime");
});

test("parseYcJobsFromDomCards avoids mislabeling location or tenure as company", () => {
  const cards = [
    {
      href: "https://www.workatastartup.com/jobs/88504",
      title: "Founding Senior Product Manager",
      company: "",
      companyUrl: "",
      cardText:
        "Founding Senior Product Manager\nJob match\nSan Francisco Bay Area\nFulltime\nUS Citizen/Visa Only\n$200K - $290K\n11+ Years"
    }
  ];

  const jobs = parseYcJobsFromDomCards(cards, {
    searchUrl:
      "https://www.workatastartup.com/companies?query=ai&role=product&sortBy=keyword&layout=list-compact",
    domCards: true,
    assumeQueryFiltered: true
  });

  assert.equal(jobs.length, 0);
});

test("parseYcJobsFromDomCards falls back to company slug when text is ambiguous", () => {
  const cards = [
    {
      href: "https://www.workatastartup.com/jobs/89862",
      title: "Head of Product",
      company: "",
      companyUrl: "/companies/ai-prise",
      cardText:
        "Head of Product\nJob match\nSan Jose, CA, US\nFulltime\n$190K - $215K\nSee all 11 jobs ›"
    }
  ];

  const jobs = parseYcJobsFromDomCards(cards, {
    searchUrl:
      "https://www.workatastartup.com/companies?query=ai&role=product&sortBy=keyword&layout=list-compact",
    domCards: true,
    assumeQueryFiltered: true
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, "Ai Prise");
});

test("parseYcJobsFromDomCards ignores 'see all jobs' company text", () => {
  const cards = [
    {
      href: "https://www.workatastartup.com/jobs/89862",
      title: "Head of Product",
      company: "See all 11 jobs ›",
      companyUrl: "/companies/aiprise",
      cardText:
        "Head of Product\nJob match\nSan Jose, CA, US\nFulltime\n$190K - $215K\nSee all 11 jobs ›"
    }
  ];

  const jobs = parseYcJobsFromDomCards(cards, {
    searchUrl:
      "https://www.workatastartup.com/companies?query=ai&role=product&sortBy=keyword&layout=list-compact",
    domCards: true,
    assumeQueryFiltered: true
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, "Aiprise");
});

test("parseYcJobsFromDomCards ignores view/sponsor lines as company", () => {
  const cards = [
    {
      href: "https://www.workatastartup.com/jobs/80987",
      title: "Product Manager - AI",
      company: "View job",
      companyUrl: "/companies/ai-video",
      cardText:
        "Product Manager - AI\nJob match\nSan Francisco, CA, US / Remote (US)\nFulltime\nWill Sponsor\n$125K - $165K\nView job"
    }
  ];

  const jobs = parseYcJobsFromDomCards(cards, {
    searchUrl:
      "https://www.workatastartup.com/companies?query=ai&role=product&sortBy=keyword&layout=list-compact",
    domCards: true,
    assumeQueryFiltered: true
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, "Ai Video");
});

test("parseYcJobsFromDomCards ignores other job titles as company", () => {
  const cards = [
    {
      href: "https://www.workatastartup.com/jobs/99999",
      title: "Product Manager - AI",
      company: "",
      companyUrl: "/companies/retell-ai",
      cardText:
        "Product Manager - AI\nTechnical Product Manager\nSan Francisco, CA, US\nFulltime"
    }
  ];

  const jobs = parseYcJobsFromDomCards(cards, {
    searchUrl:
      "https://www.workatastartup.com/companies?query=ai&role=product&sortBy=keyword&layout=list-compact",
    domCards: true,
    assumeQueryFiltered: true
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, "Retell Ai");
});

test("parseYcJobsFromDomCards drops non-job navigation rows", () => {
  const cards = [
    {
      href: "https://www.workatastartup.com/jobs/00000",
      title: "Product Manager Jobs",
      company: "Inbox",
      companyUrl: "/inbox",
      cardText: "Product Manager Jobs\nInbox\nView job"
    }
  ];

  const jobs = parseYcJobsFromDomCards(cards, {
    searchUrl:
      "https://www.workatastartup.com/companies?query=ai&role=product&sortBy=keyword&layout=list-compact",
    domCards: true,
    assumeQueryFiltered: true
  });

  assert.equal(jobs.length, 0);
});

test("getYcRecencyFraction maps JobFinder recency buckets", () => {
  assert.equal(getYcRecencyFraction("24h"), 0.1);
  assert.equal(getYcRecencyFraction("3d"), 0.3);
  assert.equal(getYcRecencyFraction("1w"), 0.5);
  assert.equal(getYcRecencyFraction("2w"), 0.75);
  assert.equal(getYcRecencyFraction("1m"), 1);
  assert.equal(getYcRecencyFraction("any"), 1);
  assert.equal(getYcRecencyFraction("not set"), 1);
});

test("resolveYcRecencyFraction prefers source searchCriteria then falls back to global criteria", () => {
  assert.equal(
    resolveYcRecencyFraction(
      { searchCriteria: { datePosted: "3d" } },
      { datePosted: "1w" }
    ),
    0.3
  );
  assert.equal(resolveYcRecencyFraction({}, { datePosted: "1w" }), 0.5);
  assert.equal(resolveYcRecencyFraction({}, {}), 1);
});
