import { CopyLink } from "@/components/CopyLink";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ImportReport, LineupMode, LineupSelection, PlanIssue } from "@/lib/lineup/selection";
import type { SolveFailure } from "@/lib/optimizer";
import { ImportNotice } from "./ImportNotice";
import { ISSUE_LABEL, failureText, names } from "./helpers";

type LineupView = {
  running: boolean;
  cancelled: boolean;
  failure: { code: string; message: string } | null;
  current: unknown;
};

type Props = {
  selection: LineupSelection;
  mode: LineupMode;
  week: { week: number } | null | undefined;
  scoredCount: number;
  lineupView: LineupView;
  lineupPlan: { ok: boolean; issues: PlanIssue[] };
  importReport: ImportReport | null;
  hasSetup: boolean;
  lineup: unknown;
  isCurrent: boolean;
  bestFailure: SolveFailure | null;
  linkTo: (s: LineupSelection) => string;
  setStack: (v: boolean) => void;
  setMode: (m: LineupMode) => void;
  run: () => void;
  cancel: () => void;
  reset: () => void;
  dismissImport: () => void;
};

/** Sidebar “Solve” card: stack/hindsight toggles, run/cancel/reset, import + status. */
export function SolvePanel({
  selection,
  mode,
  week,
  scoredCount,
  lineupView,
  lineupPlan,
  importReport,
  hasSetup,
  lineup,
  isCurrent,
  bestFailure,
  linkTo,
  setStack,
  setMode,
  run,
  cancel,
  reset,
  dismissImport,
}: Props) {
  return (
    <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">Solve</p>
      <label className="mt-4 flex items-center gap-3 text-sm">
        <Checkbox checked={selection.stack} onCheckedChange={(v) => setStack(v === true)} />
        Stack QB with a WR/TE
      </label>
      <label className="mt-3 flex items-center gap-3 text-sm">
        <Checkbox
          checked={mode === "actual"}
          onCheckedChange={(v) => setMode(v === true ? "actual" : "proj")}
          disabled={mode !== "actual" && (!week || scoredCount < 9)}
        />
        Solve on this week’s actuals
      </label>
      <p className="mt-2 text-xs text-subtle" data-testid="selection-counts">
        {selection.locked.length} locked · {selection.excluded.length} excluded
        {week ? ` · ${scoredCount} scored` : ""}
      </p>
      <div className="mt-5 flex gap-2">
        <Button className="flex-1" onClick={run} disabled={lineupView.running || !lineupPlan.ok}>
          {lineupView.running ? "Solving…" : mode === "actual" ? "Hindsight lineup" : "Build lineup"}
        </Button>
        {lineupView.running && (
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
      {hasSetup && (
        <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={reset}>
          Reset
        </Button>
      )}
      <div className="mt-3 space-y-2 text-sm" data-testid="solve-status" aria-live="polite">
        {importReport && <ImportNotice report={importReport} onDismiss={dismissImport} />}
        {!lineupPlan.ok &&
          lineupPlan.issues.map((issue) => (
            <p key={issue.code} className="text-rust" data-issue={issue.code}>
              {issue.message}
              {issue.ids.length ? (
                <span className="mt-0.5 block text-xs">
                  {ISSUE_LABEL[issue.code]}: {names(issue.ids)}
                </span>
              ) : null}
            </p>
          ))}
        {lineupView.running && <p className="text-muted">Solving in the background. Cancel stops it.</p>}
        {lineupView.failure && (
          <div className="text-rust" data-failure={lineupView.failure.code}>
            <p>{lineupView.failure.message} Nothing was solved on the page instead.</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={run} disabled={!lineupPlan.ok}>
              Retry
            </Button>
          </div>
        )}
        {!lineupView.running && lineupView.cancelled && (
          <p className="text-muted">Cancelled. Nothing was solved for this setup.</p>
        )}
        {bestFailure && (
          <p className="text-rust" data-solve-status={bestFailure.status}>
            {failureText(bestFailure, mode)}
          </p>
        )}
        {!lineupView.running && lineupPlan.ok && lineup && !isCurrent && !lineupView.cancelled && !lineupView.failure && (
          <p className="text-muted">
            Setup changed since this lineup was built. {mode === "actual" ? "Hindsight lineup" : "Build lineup"} to update it.
          </p>
        )}
      </div>
      <CopyLink className="mt-4" label="Copy link to this setup" getUrl={() => `${window.location.origin}${linkTo(selection)}`} />
      <p className="mt-1 text-xs text-subtle">
        A link reopens these constraints and solves them again on whatever scores are loaded then.
      </p>
    </div>
  );
}
