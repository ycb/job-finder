import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function toneClassName(status) {
  if (status === "applied") {
    return "bg-emerald-700/10 text-emerald-900";
  }
  if (status === "rejected") {
    return "bg-destructive/10 text-destructive";
  }
  if (status === "skip_for_now") {
    return "bg-amber-600/10 text-amber-900";
  }
  return "bg-primary/10 text-primary";
}

export function JobsQueuePanel({ queue, onSelectJob }) {
  const hasJobs = queue.jobs.length > 0;

  return (
    <Card className="h-full border-border/80 bg-card/95">
      <CardHeader className="border-b border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Ranked Jobs
            </p>
            <CardTitle>{queue.total} jobs in view</CardTitle>
          </div>
          <div className="rounded-full border border-border/70 px-3 py-1 text-sm font-medium text-muted-foreground">
            Queue list
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {hasJobs ? (
          <div className="space-y-3">
            {queue.jobs.map((job) => {
              const active = queue.selectedJobId === job.id;
              return (
                <button
                  key={job.id}
                  type="button"
                  className={cn(
                    "block w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md",
                    active
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/70 bg-background/65 hover:border-primary/35",
                  )}
                  onClick={() => onSelectJob(job.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-base font-semibold text-foreground">{job.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {job.company} · {job.location}
                      </p>
                    </div>
                    <div className="rounded-full border border-border/60 bg-card px-3 py-1 text-sm font-semibold text-foreground">
                      {job.scoreLabel}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                      {job.bucketLabel}
                    </span>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", toneClassName(job.status))}>
                      {job.statusLabel}
                    </span>
                    <span className="rounded-full border border-border/70 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                      {job.freshnessLabel}
                    </span>
                    {job.duplicateCount > 1 ? (
                      <span className="rounded-full border border-border/70 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                        Seen in {job.duplicateCount} searches
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-background/50 p-8 text-center text-sm text-muted-foreground">
            {queue.emptyLabel}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
