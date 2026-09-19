import type { StudyRunSummary } from "@/data/types";
import {
  COMPUTER,
  ROLE_WORDS,
  TOP_NAMES,
  cn,
  computerOver,
  fix,
  mean,
  model,
  pool,
  range,
  signed,
  study,
  verdict,
  type View,
} from "./shared";
import { ViewPicker } from "./ViewPicker";

export function DidItHelp({
  view,
  setViewKey,
  summary,
  label,
}: {
  view: View;
  setViewKey: (key: string) => void;
  summary: StudyRunSummary;
  label: string;
}) {
  const top = computerOver(summary, TOP_NAMES);
  const answer = top.low != null && top.low > 0 ? "Yes." : top.high != null && top.high < 0 ? "No." : "Not clearly.";
  const rows = [
    ...study.seasons.map((s) => ({ key: String(s.season), label: String(s.season), note: ROLE_WORDS[s.role], summary: s.summary, muted: false })),
    ...(pool ? [{ key: "pool", label, note: "all seasons", summary: pool.summary, muted: false }] : []),
    ...(study.shippedSlate
      ? [{ key: "shipped", label: `${study.shippedSlate.season} shipped`, note: "look-ahead", summary: study.shippedSlate.summary, muted: true }]
      : []),
  ];
  const weekly = view.row.weekly;
  const vs = view.row.summary;

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Did the computer help?</h2>
      <p className="mt-3 text-sm leading-relaxed">
        {answer} Over {top.n} weeks in {label} the computer averaged{" "}
        <strong className="font-medium text-fg">{fix(mean(model(summary, COMPUTER)), 1)}</strong> real
        points a week. Grabbing the top projected names that still fit averaged{" "}
        {fix(mean(model(summary, TOP_NAMES)), 1)}. That’s {signed(top.mean)} points a week for the
        computer. It won {top.wins} weeks, lost {top.losses} and tied {top.ties} (a tie means both
        built the same team). The 95% range for that weekly gap runs from {range(top)}; {verdict(top)}.
        Points-per-dollar / cheap-picks baselines were dropped from the study path.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
            <tr className="border-b border-border">
              <th className="py-2 font-medium">Season</th>
              <th className="py-2 text-right font-medium">Weeks</th>
              <th className="py-2 text-right font-medium">Computer</th>
              <th className="py-2 text-right font-medium">Top names</th>
              <th className="py-2 text-right font-medium">Gap (95% range)</th>
              <th className="py-2 text-right font-medium">W-L-T</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((r) => {
              const g = computerOver(r.summary, TOP_NAMES);
              return (
                <tr key={r.key} className={cn("border-b border-border/70", r.muted ? "text-muted" : undefined)}>
                  <td className="py-1.5 font-sans">
                    {r.label} <span className="text-xs text-muted">{r.note}</span>
                  </td>
                  <td className="py-1.5 text-right">{r.summary.commonWeeks.length}</td>
                  <td className="py-1.5 text-right">{fix(mean(model(r.summary, COMPUTER)), 1)}</td>
                  <td className="py-1.5 text-right">{fix(mean(model(r.summary, TOP_NAMES)), 1)}</td>
                  <td className="py-1.5 text-right">
                    {signed(g.mean)} <span className="text-xs text-muted">({range(g)})</span>
                  </td>
                  <td className="py-1.5 text-right">
                    {g.wins}-{g.losses}-{g.ties}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Gap = computer minus top names, per week. 95% range: we resampled the weeks{" "}
        {study.uncertainty.resamples.toLocaleString("en-US")} times and kept the middle 95% of the
        average gap. Each week counts once, because nine players in one lineup are not nine separate
        tests. It is a rough guide, not a significance test. The shipped slate row uses the fixed
        114-player {study.shippedSlate?.season ?? ""} pool, which was picked and priced with that
        whole season’s numbers.
      </p>

      <h3 className="mt-8 text-sm font-medium">Week by week</h3>
      <ViewPicker viewKey={view.key} setViewKey={setViewKey} />
      <p className="mt-3 text-sm text-muted">
        {view.label} ({view.note}). Green = computer beat the top-names pick that week.
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
            <tr className="border-b border-border">
              <th className="py-2 font-medium">Week</th>
              <th className="py-2 text-right font-medium">Computer</th>
              <th className="py-2 text-right font-medium">Top names</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {weekly.map((w) => {
              const c = w.lineups[COMPUTER]!.actual;
              const t = w.lineups[TOP_NAMES]!.actual;
              return (
                <tr key={w.week} className="border-b border-border/70">
                  <td className="py-1.5">{w.week}</td>
                  <td className={cn("py-1.5 text-right", c > t ? "text-sage" : undefined)}>{fix(c, 1)}</td>
                  <td className="py-1.5 text-right">{fix(t, 1)}</td>
                </tr>
              );
            })}
            <tr>
              <td className="py-2">Mean</td>
              <td className="py-2 text-right">{fix(mean(model(vs, COMPUTER)), 1)}</td>
              <td className="py-2 text-right">{fix(mean(model(vs, TOP_NAMES)), 1)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
