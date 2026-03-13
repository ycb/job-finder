import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const FIELD_BASE_CLASS =
  "h-11 w-full rounded-md border border-input bg-card/80 px-3 text-sm font-medium text-foreground shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";

function CriteriaField({ label, name, value, onChange, placeholder, className = "", type = "text" }) {
  return (
    <label className={cn("grid gap-2 text-sm font-medium text-foreground", className)}>
      <span>{label}</span>
      <input
        className={FIELD_BASE_CLASS}
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(name, event.target.value)}
      />
    </label>
  );
}

function CriteriaSelect({ label, name, value, onChange, options }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-foreground">
      <span>{label}</span>
      <select
        className={FIELD_BASE_CLASS}
        name={name}
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value || "empty"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function JobsCriteriaShell({
  criteria,
  statusText,
  hintText,
  datePostedOptions,
  findJobsLabel,
  onCriteriaChange,
  onFindJobs,
}) {
  return (
    <Card className="overflow-hidden border-border/80 bg-gradient-to-br from-card via-card to-secondary/30">
      <CardHeader className="border-b border-border/60 bg-card/70">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              Search Criteria
            </p>
            <CardTitle>Shape the intake before you run the queue.</CardTitle>
            <CardDescription>{hintText}</CardDescription>
          </div>
          <div className="rounded-full border border-emerald-700/15 bg-emerald-700/10 px-4 py-2 text-sm font-medium text-primary">
            {statusText}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CriteriaField
            label="Title"
            name="title"
            value={criteria.title}
            onChange={onCriteriaChange}
            placeholder="Senior Product Manager"
          />
          <CriteriaField
            label="Keywords"
            name="keywords"
            value={criteria.keywords}
            onChange={onCriteriaChange}
            placeholder="payments, growth"
          />
          <CriteriaSelect
            label="Keyword Mode"
            name="keywordMode"
            value={criteria.keywordMode}
            onChange={onCriteriaChange}
            options={[
              { value: "and", label: "AND" },
              { value: "or", label: "OR" },
            ]}
          />
          <CriteriaField
            label="Location"
            name="location"
            value={criteria.location}
            onChange={onCriteriaChange}
            placeholder="San Francisco, CA"
          />
          <CriteriaField
            label="Include"
            name="includeTerms"
            value={criteria.includeTerms}
            onChange={onCriteriaChange}
            placeholder="AI, B2B"
            className="md:col-span-2"
          />
          <CriteriaField
            label="Exclude"
            name="excludeTerms"
            value={criteria.excludeTerms}
            onChange={onCriteriaChange}
            placeholder="intern, contract"
            className="md:col-span-2"
          />
          <CriteriaField
            label="Minimum Salary"
            name="minSalary"
            value={criteria.minSalary}
            onChange={onCriteriaChange}
            placeholder="195000"
            type="number"
          />
          <CriteriaSelect
            label="Posted On"
            name="datePosted"
            value={criteria.datePosted}
            onChange={onCriteriaChange}
            options={datePostedOptions}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/50 p-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Find Jobs visual shell</p>
            <p className="text-sm text-muted-foreground">
              This lane keeps the form live and local. Save + fetch behavior lands in J3.
            </p>
          </div>
          <Button className="min-w-40 shadow-sm" onClick={onFindJobs}>
            {findJobsLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
