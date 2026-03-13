import { JobsCriteriaShell } from "@/features/jobs/JobsCriteriaShell";
import { JobsControlsRail } from "@/features/jobs/JobsControlsRail";
import { JobsQueuePanel } from "@/features/jobs/JobsQueuePanel";
import { JobDetailPanel } from "@/features/jobs/JobDetailPanel";

export function JobsWorkspace({
  model,
  onCriteriaChange,
  onFindJobs,
  onViewChange,
  onSortChange,
  onSourceChange,
  onPageChange,
  onSelectJob,
}) {
  return (
    <div className="space-y-6" data-jobs-ui-shell="1">
      <JobsCriteriaShell
        criteria={model.criteria}
        statusText={model.criteriaStatus}
        hintText={model.criteriaHint}
        datePostedOptions={model.datePostedOptions}
        findJobsLabel={model.findJobsLabel}
        onCriteriaChange={onCriteriaChange}
        onFindJobs={onFindJobs}
      />

      <JobsControlsRail
        summary={model.summary}
        controls={model.controls}
        onViewChange={onViewChange}
        onSortChange={onSortChange}
        onSourceChange={onSourceChange}
        onPageChange={onPageChange}
      />

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <JobsQueuePanel queue={model.queue} onSelectJob={onSelectJob} />
        <JobDetailPanel detail={model.detail} />
      </div>
    </div>
  );
}
