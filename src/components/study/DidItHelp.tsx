import type { StudyRunSummary } from "@/data/types";
import { Caption, TableCard, Tag } from "./parts";
import { td, tdR, th, thR } from "./table";
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
} from "./shared";

/** Archive: the retired salary-cap comparison (computer vs top projected names). */
export function DidItHelp({ summary, label }: { summary: StudyRunSummary; label: string }) {
  const top = computerOver(summary, TOP_NAMES);
  const answer = top.low != null && top.low > 0 ? "Yes." : top.high != null && top.high < 0 ? "No." : "Not clearly.";
  const rows = [
    ...study.seasons.map((s) => ({ key: String(s.season), label: String(s.season), note: ROLE_WORDS[s.role], summary: s.summary, muted: false })),
    ...(pool ? [{ key: "pool", label, note: "all seasons", summary: pool.summary, muted: false }] : []),
    ...(study.shippedSlate
      ? [{ key: "shipped", label: `${study.shippedSlate.season} shipped`, note: "look-ahead", summary: study.shippedSlate.summary, muted: true }]
      : []),
  ];

  return (
    <>
      <h3 className="mt-9 font-display text-[26px] leading-[1.15]">Did the computer help?</h3>
      <p className="mt-3 max-w-[48em] text-base">
        <b className="font-semibold">{answer}</b> Over {top.n} weeks in {label} the computer averaged{" "}
        {fix(mean(model(summary, COMPUTER)), 1)} real points a week. Grabbing the top projected names that still fit
        averaged {fix(mean(model(summary, TOP_NAMES)), 1)}. That’s {signed(top.mean)} points a week for the computer.
        It won {top.wins} weeks, lost {top.losses} and tied {top.ties} (a tie means both built the same team). The 95%
        range for that weekly gap runs from {range(top)}; {verdict(top)}. Points-per-dollar and cheap-picks baselines
        were dropped from the study path.
      </p>
      <TableCard className="mt-[18px]">
        <table className="w-full min-w-[560px] border-collapse text-[15px]">
          <thead>
            <tr>
              <th className={th}>Season</th>
              <th className={thR}>Weeks</th>
              <th className={thR}>Computer</th>
              <th className={thR}>Top names</th>
              <th className={thR}>Gap (95% range)</th>
              <th className={thR}>W-L-T</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const g = computerOver(r.summary, TOP_NAMES);
              return (
                <tr key={r.key} className={cn(r.muted && "text-muted")}>
                  <td className={cn(td, "whitespace-nowrap")}>
                    {r.label} <Tag tone={r.muted ? "look" : "plain"}>{r.note}</Tag>
                  </td>
                  <td className={tdR}>{r.summary.commonWeeks.length}</td>
                  <td className={tdR}>{fix(mean(model(r.summary, COMPUTER)), 1)}</td>
                  <td className={tdR}>{fix(mean(model(r.summary, TOP_NAMES)), 1)}</td>
                  <td className={tdR}>
                    {signed(g.mean)} <span className="text-[13px] text-muted">({range(g)})</span>
                  </td>
                  <td className={tdR}>
                    {g.wins}-{g.losses}-{g.ties}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>
      <Caption>
        Gap = computer minus top names, per week. 95% range: we resampled the weeks{" "}
        {study.uncertainty.resamples.toLocaleString("en-US")} times and kept the middle 95% of the average gap. Each
        week counts once, because nine players in one lineup are not nine separate tests. It is a rough guide, not a
        significance test. The shipped slate row uses the fixed 114-player {study.shippedSlate?.season ?? ""} pool, which
        was picked and priced with that whole season’s numbers.
      </Caption>
    </>
  );
}
