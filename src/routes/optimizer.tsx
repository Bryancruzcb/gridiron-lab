import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import fantasyFile from "@/data/fantasy.json";
import { FeedStatus } from "@/components/DataStatus";
import { AppShell } from "@/components/layout/AppShell";
import {
  BacktestPanel,
  LineupResult,
  PlayerRows,
  SolvePanel,
  ValueGreedyCard,
  download,
  idsFrom,
  setupName,
} from "@/components/optimizer";
import { FirstLook } from "@/components/FirstLook";
import { Pager } from "@/components/Pager";
import { SavedAnalyses, type SavedEvent } from "@/components/SavedAnalyses";
import { StatTip } from "@/components/StatTip";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { FantasyFile, FantasyPlayer, FantasyPos } from "@/data/types";
import { buildLineupExport, exportFilename, lineupCsv, lineupJson } from "@/lib/analysis/export";
import {
  decodeOptimizerSearch,
  encodeOptimizerSearch,
  isEmptySelection,
  selectionKey,
  validateOptimizerSearch,
} from "@/lib/analysis/state";
import {
  actualsVersion,
  slateId,
  type LineupSelection,
} from "@/lib/lineup/selection";
import { useLineupSolver, type SelectionWrite } from "@/lib/lineup/use-lineup-solver";
import { actualsByPlayer } from "@/lib/match";
import { scoreLineup } from "@/lib/optimizer";
import { usePaged } from "@/lib/paging";
import { useSeason } from "@/lib/season-provider";

export const Route = createFileRoute("/optimizer")({
  validateSearch: (raw: Record<string, unknown>) => validateOptimizerSearch(raw, SLATE),
  component: OptimizerLab,
});

const data = fantasyFile as FantasyFile;
const players = data.players as FantasyPlayer[];
const PROJECTIONS = new Map(players.map((p) => [p.id, p.proj]));
const SLATE = slateId(data.season, players, data.cap);
const POS: (FantasyPos | "ALL")[] = ["ALL", "QB", "RB", "WR", "TE", "DST"];

function OptimizerLab() {
  const { weekPpr, feeds } = useSeason();
  const navigate = useNavigate();
  const router = useRouter();
  const [pos, setPos] = useState<(typeof POS)[number]>("ALL");
  const [q, setQ] = useState("");
  const week = weekPpr;

  // The URL is the source of truth for the selection; the solver hook imports links and reports edits.
  const search = Route.useSearch();
  const link = useMemo(() => decodeOptimizerSearch(search, SLATE), [search]);
  const writeSelection = useCallback(
    (next: LineupSelection, how: SelectionWrite) => {
      void navigate({
        to: "/optimizer",
        search: isEmptySelection(next) && next.slate === SLATE ? {} : encodeOptimizerSearch(next),
        replace: how === "replace",
        resetScroll: false,
      });
    },
    [navigate],
  );

  const actuals = useMemo(() => (week ? actualsByPlayer(players, week.players) : null), [week]);
  const actualsV = useMemo(() => actualsVersion(actuals), [actuals]);
  const notFinal = useMemo(
    () => (week && actuals ? idsFrom(week, actuals, (w) => w.status !== "post" || w.score.status !== "complete") : new Set<string>()),
    [week, actuals],
  );
  const partial = useMemo(
    () => (week && actuals ? idsFrom(week, actuals, (w) => w.score.status !== "complete") : new Set<string>()),
    [week, actuals],
  );
  // Exports tell "game still in progress" apart from "final with an input unavailable"; the page's
  // not-final marker above deliberately covers both, because either score can still change.
  const inProgress = useMemo(
    () => (week && actuals ? idsFrom(week, actuals, (w) => w.status !== "post") : new Set<string>()),
    [week, actuals],
  );
  const solver = useLineupSolver({ players, cap: data.cap, actuals, slate: SLATE, link, onSelectionChange: writeSelection });
  const { selection, lineup: lineupView, compare, lineupPlan, importReport } = solver;
  const { mode } = selection;
  const scoredCount = actuals?.size ?? 0;
  const lockedIds = useMemo(() => new Set(selection.locked), [selection.locked]);
  const excludedIds = useMemo(() => new Set(selection.excluded), [selection.excluded]);

  // The saved view the setup came from, so an export can carry its name while the setup is unchanged.
  const [savedRef, setSavedRef] = useState<{ id: string; name: string; key: string } | null>(null);
  const savedName = savedRef && savedRef.key === selectionKey(selection) ? savedRef.name : null;
  const onSavedEvent = (event: SavedEvent<"optimizer">) => {
    if (event.type === "deleted") setSavedRef((r) => (r?.id === event.id ? null : r));
    else if (event.type === "renamed") setSavedRef((r) => (r?.id === event.record.id ? { ...r, name: event.record.name } : r));
    else setSavedRef({ id: event.record.id, name: event.record.name, key: selectionKey(event.record.state) });
  };

  const linkTo = (s: LineupSelection) => router.buildLocation({ to: "/optimizer", search: encodeOptimizerSearch(s) }).href;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return players
      .filter((p) => (pos === "ALL" ? true : p.pos === pos))
      .filter((p) => (needle ? p.name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle) : true))
      .slice()
      .sort((a, b) => {
        if (mode === "actual") return (actuals?.get(b.id) ?? -1) - (actuals?.get(a.id) ?? -1);
        return b.proj - a.proj;
      });
  }, [pos, q, mode, actuals]);
  // One page of the pool at a time; a new position, search or scoring mode starts again at page 1.
  const paged = usePaged(filtered, 25, `${pos}|${q}|${mode}`);

  const shown = lineupView.current ?? lineupView.outdated;
  const outcome = shown?.outcome ?? null;
  const best = outcome?.best.status === "ok" ? outcome.best : null;
  const lineup = best?.lineup ?? null;
  const isCurrent = lineupView.current !== null;
  const hindsight = outcome?.mode === "actual";
  const bestFailure = lineupView.current && lineupView.current.outcome.best.status !== "ok" ? lineupView.current.outcome.best : null;
  const alt =
    outcome && best && outcome.alternate.status === "ok" && Math.abs(outcome.alternate.lineup.proj - best.lineup.proj) > 0.2
      ? outcome.alternate.lineup
      : null;
  const hasSetup = selection.locked.length > 0 || selection.excluded.length > 0 || selection.stack || mode === "actual";

  const slots = lineup ? lineup.slots : [];
  const usedPct = lineup ? lineup.salary / data.cap : 0;
  const actualScore = lineup && actuals && !hindsight ? scoreLineup(lineup.players, actuals) : null;
  const lineupNotFinal = lineup ? lineup.players.filter((p) => notFinal.has(p.id)).length : 0;
  const leader = week?.players[0];

  const cmpSettled = compare.current ?? compare.outdated;
  const cmp = cmpSettled?.outcome ?? null;
  const cmpMissing =
    cmp && actuals
      ? [cmp.exact, cmp.hillClimb, cmp.greedyValue].some((r) => r.status === "ok" && scoreLineup(r.lineup.players, actuals).missing.length > 0)
      : false;

  /** Export the current result exactly as shown, with the inputs it was built on. */
  const exportResult = (format: "json" | "csv") => {
    const current = lineupView.current;
    if (!current || current.outcome.best.status !== "ok") return;
    const feed = feeds.weekPpr;
    const exp = buildLineupExport({
      exportedAt: new Date(),
      slate: SLATE,
      slateSeason: data.season,
      cap: data.cap,
      selection,
      mode: current.outcome.mode,
      result: current.outcome.best,
      fingerprint: current.fingerprint,
      projections: PROJECTIONS,
      actuals,
      actualsVersion: actualsV,
      partialIds: partial,
      notFinalIds: inProgress,
      week: week ? { season: week.season, seasonType: week.seasonType, week: week.week } : null,
      weekFeed: feed.data ? { source: feed.sourceKind, fetchedAt: feed.dataAsOf, partial: feed.partial, error: feed.error?.message ?? null } : null,
      reopenPath: linkTo(selection),
      savedName,
    });
    if (format === "json") download(exportFilename(exp, "json"), "application/json", lineupJson(exp));
    else download(exportFilename(exp, "csv"), "text/csv;charset=utf-8", lineupCsv(exp));
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="max-w-2xl">
          <h1 className="font-display text-5xl uppercase tracking-[0.03em] sm:text-6xl">Lineup</h1>
          <p className="mt-2 text-sm text-muted">
            Demo salaries only — not part of the study claim. Prices are illustrative synthetics, not
            real DraftKings.
          </p>
        </header>
        <FirstLook id="lineup" title="This page">
          <p>
            Demo lab only — not the study claim. Build a roster under a demo $50k cap with
            illustrative synthetic salaries (not real DraftKings or market prices). Lock forces a
            player in; bench keeps him out. Hindsight rebuilds on this week’s actual points.
          </p>
        </FirstLook>

        {week && (
          <div className="mt-6 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">
                2026 week {week.week} · {week.gamesFinal} final
                {week.gamesLive ? ` · ${week.gamesLive} live` : ""}
              </p>
              {leader && leader.pos !== "DST" && (
                <p className="text-sm text-muted">
                  {leader.name} leads at{" "}
                  <span className="font-mono text-fg tabular-nums">{leader.ppr.toFixed(1)}</span>
                </p>
              )}
            </div>
          </div>
        )}

        <FeedStatus feed="weekPpr" className="mt-4" />

        <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_340px]">
          {/* min-w-0: a grid item defaults to min-width:auto and would stretch to the table's 620px minimum on phones. */}
          <div className="min-w-0 rounded-xl bg-surface shadow-[var(--shadow-border)]">
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <Segmented
                value={pos}
                onChange={setPos}
                options={POS.map((p) => ({ value: p, label: p === "ALL" ? "All" : p }))}
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search player or team"
                className="sm:max-w-[220px]"
              />
            </div>
            <div ref={paged.topRef} className="scroll-mt-24">
              <Pager
                where="top"
                noun="players"
                page={paged.page}
                pages={paged.pages}
                pageSize={paged.pageSize}
                total={paged.total}
                onPage={paged.goTo}
                className="px-4 pb-3"
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                    <tr className="border-y border-border">
                      <th className="px-4 py-2 font-medium">Player</th>
                      <th className="px-2 py-2 font-medium">Pos</th>
                      <th className="px-2 py-2 text-right font-medium">
                        <StatTip metric="proj" />
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        <StatTip metric="actual" />
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        <StatTip metric="salary" />
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        <StatTip metric="val" />
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        <span className="text-[10px] tracking-wide text-subtle uppercase">Lock / bench</span>
                      </th>
                    </tr>
                  </thead>
                  <PlayerRows
                    rows={paged.rows}
                    lockedIds={lockedIds}
                    excludedIds={excludedIds}
                    actuals={actuals}
                    notFinal={notFinal}
                    mode={mode}
                    onLock={solver.toggleLock}
                    onBench={solver.toggleExclude}
                  />
                </table>
              </div>
              <Pager
                where="bottom"
                noun="players"
                page={paged.page}
                pages={paged.pages}
                pageSize={paged.pageSize}
                total={paged.total}
                onPage={paged.goTo}
                className="px-4 py-3"
              />
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <SolvePanel
              selection={selection}
              mode={mode}
              week={week}
              scoredCount={scoredCount}
              lineupView={lineupView}
              lineupPlan={lineupPlan}
              importReport={importReport}
              hasSetup={hasSetup}
              lineup={lineup}
              isCurrent={isCurrent}
              bestFailure={bestFailure}
              linkTo={linkTo}
              setStack={solver.setStack}
              setMode={solver.setMode}
              run={solver.run}
              cancel={solver.cancel}
              reset={solver.reset}
              dismissImport={solver.dismissImport}
            />

            {lineup && best && shown && outcome && (
              <LineupResult
                isCurrent={isCurrent}
                hindsight={hindsight}
                best={best}
                shown={shown}
                outcome={outcome}
                lineup={lineup}
                usedPct={usedPct}
                cap={data.cap}
                slate={SLATE}
                actualsV={actualsV}
                actualScore={actualScore}
                lineupNotFinal={lineupNotFinal}
                lockedIds={lockedIds}
                actuals={actuals}
                exportResult={exportResult}
              />
            )}

            {alt && <ValueGreedyCard proj={alt.proj} isCurrent={isCurrent} />}

            <SavedAnalyses
              kind="optimizer"
              current={() => ({ state: selection, datasetRef: selection.slate })}
              suggestedName={setupName(selection)}
              onOpen={(record) => void navigate({ to: "/optimizer", search: encodeOptimizerSearch(record.state), resetScroll: false })}
              onEvent={onSavedEvent}
              datasetNote={(record) => (record.datasetRef && record.datasetRef !== SLATE ? "made for another slate" : null)}
            />

            {actuals && actuals.size > 0 && (
              <BacktestPanel
                compareCurrent={compare.current !== null}
                compareRunning={compare.running}
                compareFailure={compare.failure}
                cmp={cmp}
                actuals={actuals}
                cmpMissing={cmpMissing}
                notFinalSize={notFinal.size}
                retryCompare={solver.retryCompare}
              />
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
