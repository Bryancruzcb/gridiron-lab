import type { ImportReport } from "@/lib/lineup/selection";
import { cn } from "@/lib/utils";
import { names } from "./helpers";

export function ImportNotice({ report, onDismiss }: { report: ImportReport; onDismiss: () => void }) {
  const fromLink = report.source !== "memory";
  return (
    <div className={cn("rounded-md p-3 text-sm", report.applied ? "bg-elevated text-muted" : "bg-rust/10 text-rust")} data-import-source={report.source}>
      <p className="font-medium">
        {report.applied
          ? fromLink
            ? "Opened this setup, with a note."
            : "Restored your last setup, with a note."
          : "That lineup setup was not applied."}
      </p>
      {!report.applied && fromLink && <p className="mt-0.5">Nothing from the link was applied.</p>}
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {report.issues.map((issue) => (
          <li key={issue.code + issue.message}>
            {issue.message}
            {issue.ids?.length ? ` ${names(issue.ids)}.` : ""}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onDismiss} className="mt-2 text-xs underline underline-offset-2">
        Dismiss
      </button>
    </div>
  );
}
