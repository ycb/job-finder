import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function DetailTag({ children, tone = "muted" }) {
  const className =
    tone === "strong"
      ? "border-primary/20 bg-primary/10 text-primary"
      : tone === "danger"
        ? "border-destructive/20 bg-destructive/10 text-destructive"
        : "border-border/70 bg-background/70 text-foreground";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${className}`}>{children}</span>
  );
}

export function JobDetailPanel({ detail }) {
  if (!detail.job) {
    return (
      <Card className="h-full border-border/80 bg-card/95">
        <CardContent className="flex h-full min-h-[420px] items-center justify-center text-sm text-muted-foreground">
          Select a role from the queue to inspect the detail panel.
        </CardContent>
      </Card>
    );
  }

  const { job } = detail;

  return (
    <Card className="h-full border-border/80 bg-card/95">
      <CardHeader className="border-b border-border/60 bg-gradient-to-br from-background via-background to-secondary/35">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Review Detail
              </p>
              <CardTitle className="max-w-3xl text-2xl">{job.title}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {job.company} · {job.location}
              </p>
            </div>
            <div className="rounded-full border border-border/70 bg-card px-4 py-2 text-sm font-medium text-muted-foreground">
              {detail.positionLabel}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <DetailTag tone="strong">{job.scoreLabel}</DetailTag>
            <DetailTag>{job.bucketLabel}</DetailTag>
            <DetailTag>{job.statusLabel}</DetailTag>
            <DetailTag>{job.confidenceLabel}</DetailTag>
            <DetailTag>{job.freshnessLabel}</DetailTag>
            {job.status === "rejected" && job.notes ? <DetailTag tone="danger">Rejected</DetailTag> : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-semibold text-foreground">Why it fits</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{job.summary}</p>
              <ul className="mt-4 space-y-2 text-sm text-foreground">
                {job.reasons.length > 0 ? (
                  job.reasons.map((reason) => <li key={reason}>• {reason}</li>)
                ) : (
                  <li>• No specific fit reasons captured yet.</li>
                )}
              </ul>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-semibold text-foreground">Actions preview</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" disabled>
                  I Applied
                </Button>
                <Button variant="outline" disabled>
                  Skip For Now
                </Button>
                <Button variant="outline" disabled>
                  Reject
                </Button>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{detail.actionNote}</p>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-semibold text-foreground">Role snapshot</p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Salary</dt>
                  <dd className="font-medium text-foreground">{job.salaryText}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Employment</dt>
                  <dd className="font-medium text-foreground">{job.employmentType}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Source count</dt>
                  <dd className="font-medium text-foreground">{job.sourceLabels.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Search overlap</dt>
                  <dd className="font-medium text-foreground">{job.duplicateCount}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-semibold text-foreground">Attribution</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {job.sourceLabels.map((source) => (
                  <li key={source.id}>
                    <span className="font-medium text-foreground">{source.name}</span> · {source.type}
                  </li>
                ))}
              </ul>
            </div>

            {job.notes ? (
              <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
                <p className="text-sm font-semibold text-foreground">
                  {job.status === "rejected" ? "Rejection reason" : "Latest note"}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{job.notes}</p>
              </div>
            ) : null}

            <Button asChild className="w-full">
              <a href={job.reviewTarget.url} rel="noreferrer" target="_blank">
                {job.reviewTarget.label}
              </a>
            </Button>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
