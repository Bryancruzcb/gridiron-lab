import type { StudyRunSummary } from "@/data/types";
import {
  COMPUTER,
  EWMA,
  cn,
  developmentSeasons,
  exactModels,
  fix,
  mean,
  model,
  overComputer,
  projections,
  range,
  signed,
  study,
  verdict,
} from "./shared";

export function BetterGuesses({ summary, label }: { summary: StudyRunSummary; label: string }) {
  const rows = exactModels
    .map((spec) => ({ spec, m: model(summary, spec.id) }))
    .sort((a, b) => mean(b.m) - mean(a.m));
  const bestMae = [...rows].sort((a, b) => (a.m.playerError.mae ?? Infinity) - (b.m.playerError.mae ?? Infinity))[0]!;
  const bestTeam = rows[0]!;
  const trail = model(summary, COMPUTER);
  const ewmaGap = overComputer(summary, EWMA);
  const ewmaSeasons = study.seasons.filter((s) => overComputer(s.summary, EWMA).mean > 0).length;
  const shippedTrail = projections.models.find((m) => m.id === COMPUTER);
  const shippedEwma = projections.models.find((m) => m.id === EWMA);
  const shippedBestMae = [...projections.models].sort((a, b) => a.mae - b.mae)[0];
  const shippedBestTeam = [...projections.models].sort((a, b) => b.lineupMean - a.lineupMean)[0];

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Better guesses?</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Same budget, same {trail.weeks} weeks, same pools. We only changed how we guess next week’s
        points. “Miss” is how far off each player’s guess was, on average, over{" "}
        {trail.playerError.n.toLocaleString("en-US")} player-weeks. “Team score” is what the computer’s
        9-man roster actually scored with that guess. The last column is the weekly team-score gap to
        the trailing mean, with its 95% range.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
            <tr className="border-b border-border">
              <th className="py-2 font-medium">Guess method ({label})</th>
              <th className="py-2 text-right font-medium">Miss / player</th>
              <th className="py-2 text-right font-medium">Team score</th>
              <th className="py-2 text-right font-medium">vs trailing mean</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map(({ spec, m }) => {
              const g = spec.id === COMPUTER ? null : overComputer(summary, spec.id);
              return (
                <tr key={spec.id} className="border-b border-border/70">
                  <td className="py-1.5 font-sans">{spec.label}</td>
                  <td className={cn("py-1.5 text-right", spec.id === bestMae.spec.id ? "text-sage" : undefined)}>
                    {fix(m.playerError.mae ?? Number.NaN, 2)}
                  </td>
                  <td className={cn("py-1.5 text-right", spec.id === bestTeam.spec.id ? "text-sage" : undefined)}>
                    {fix(mean(m), 1)}
                  </td>
                  <td className="py-1.5 text-right">
                    {g ? (
                      <>
                        {signed(g.mean)} <span className="text-xs text-muted">({range(g)})</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm leading-relaxed">
        {bestMae.spec.label} missed least per player ({fix(bestMae.m.playerError.mae ?? Number.NaN, 2)}).{" "}
        {bestMae.spec.id === bestTeam.spec.id
          ? "It also built the best teams."
          : `Missing less per player is not the same as a better team: its teams averaged ${fix(mean(bestMae.m), 1)}, while ${bestTeam.spec.label} built the best ones (${fix(mean(bestTeam.m), 1)}).`}{" "}
        {bestTeam.spec.id === EWMA
          ? `EWMA beat the trailing mean in ${ewmaSeasons} of ${study.seasons.length} seasons, by ${signed(ewmaGap.mean)} a week overall (range ${range(ewmaGap)}; ${verdict(ewmaGap)}). Its α=0.35 is a leftover default from the first 2025 scripts, not a setting we tuned on ${developmentSeasons.join(" and ") || "earlier seasons"}.`
          : ""}
      </p>
      {shippedTrail && shippedEwma && shippedBestMae && shippedBestTeam ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          On the shipped {projections.season} slate the story shifts: {shippedBestMae.label}{" "}
          {shippedBestMae.id === bestMae.spec.id ? "still " : ""}missed least ({fix(shippedBestMae.mae, 2)}),{" "}
          {shippedBestTeam.label} built the best teams (
          {fix(shippedBestTeam.lineupMean, 1)}), and EWMA scored {fix(shippedEwma.lineupMean, 1)} against
          the trailing mean’s {fix(shippedTrail.lineupMean, 1)}. One pool and one season can flip a
          ranking.
        </p>
      ) : null}
    </section>
  );
}
