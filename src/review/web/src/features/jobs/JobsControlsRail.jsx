import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function StatPill({ label, value, tone = "default" }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 shadow-sm",
        tone === "strong"
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-border/70 bg-background/70 text-foreground",
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export function JobsControlsRail({
  summary,
  controls,
  onViewChange,
  onSortChange,
  onSourceChange,
  onPageChange,
}) {
  const { pagination, selectedSort, selectedSource, selectedView, sortOptions, sourceOptions, viewOptions } =
    controls;

  return (
    <Card className="border-border/80 bg-card/90">
      <CardContent className="space-y-5 pt-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatPill label="Active Queue" value={summary.activeCount} tone="strong" />
          <StatPill label="New" value={summary.newCount} />
          <StatPill label="Applied" value={summary.appliedCount} />
          <StatPill label="Skipped" value={summary.skippedCount} />
          <StatPill label="Rejected" value={summary.rejectedCount} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Source Focus
                </p>
                <p className="text-sm text-muted-foreground">
                  Chips stay prop-driven and local in this lane.
                </p>
              </div>
              <div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-sm font-medium text-muted-foreground">
                {pagination.total} results
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {sourceOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={selectedSource === option.value ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "rounded-full",
                    selectedSource === option.value ? "shadow-sm" : "bg-background/70",
                  )}
                  onClick={() => onSourceChange(option.value)}
                >
                  {option.label} ({option.count})
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                View Filter
              </p>
              <Select value={selectedView} onValueChange={onViewChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select view" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Queue</SelectLabel>
                    {viewOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label} ({option.count})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Sort
              </p>
              <Select value={selectedSort} onValueChange={onSortChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Sort jobs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Order</SelectLabel>
                    {sortOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Pagination</p>
            <p className="text-sm text-muted-foreground">
              Showing {pagination.start}-{pagination.end} of {pagination.total}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
            >
              Prev
            </Button>
            <div className="rounded-full border border-border/70 px-3 py-1 text-sm font-medium text-foreground">
              Page {pagination.page} of {pagination.totalPages}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
