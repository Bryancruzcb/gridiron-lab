import type { LiveGame, TeamSide } from "@/lib/live/types";
import { teamColor, teamLogo } from "@/lib/nfl";
import { cn } from "@/lib/utils";

export function Crest({
  abbr,
  logo,
  className,
}: {
  abbr: string;
  logo?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-fg/95 shadow-[var(--shadow-border)]",
        className ?? "size-10",
      )}
    >
      <img src={logo || teamLogo(abbr)} alt="" className="size-[70%] object-contain" />
    </span>
  );
}

export function LivePill({
  live,
  clock,
}: {
  live: boolean;
  clock?: string | null;
}) {
  if (!live) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1 text-[11px] font-medium tracking-wide text-bg uppercase">
      <span className="live-dot" />
      Live{clock ? ` ${clock}` : ""}
    </span>
  );
}

export function KickScore({
  away,
  home,
  className,
}: {
  away: number;
  home: number;
  className?: string;
}) {
  return (
    <p className={cn("font-display leading-none tracking-tight tabular-nums", className ?? "text-5xl")}>
      {away}
      <span className="text-fg/45">:</span>
      {home}
    </p>
  );
}

function Side({ side, big }: { side: TeamSide; big?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <Crest abbr={side.abbr} logo={side.logo} className={big ? "size-[4.5rem]" : "size-10"} />
      <p className={cn("truncate text-center font-medium", big ? "text-sm" : "text-xs")}>{side.nick}</p>
      {side.record ? <p className="text-[11px] text-fg/70">{side.record}</p> : null}
    </div>
  );
}

export function MatchHero({ game }: { game: LiveGame }) {
  const wash = teamColor(game.home.abbr);
  return (
    <div
      className="relative overflow-hidden rounded-xl px-5 py-8 text-fg"
      style={{
        background: `linear-gradient(180deg, ${wash} 0%, color-mix(in oklab, ${wash} 55%, #0a0b0d) 48%, #0a0b0d 100%)`,
      }}
    >
      <div className="flex justify-center">
        <LivePill live={game.status === "in"} clock={game.clock} />
      </div>
      <p className="mt-3 text-center font-display text-lg uppercase tracking-[0.2em]">
        {game.status === "in" ? "Live" : game.status === "post" ? "Final" : "Kickoff"}
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Side side={game.away} big />
        <KickScore away={game.away.score} home={game.home.score} className="text-6xl sm:text-7xl" />
        <Side side={game.home} big />
      </div>
      <p className="mt-4 text-center text-[11px] tracking-[0.16em] text-fg/70 uppercase">{game.statusText}</p>
    </div>
  );
}

export function MatchTile({
  game,
  active,
  onPick,
}: {
  game: LiveGame;
  active?: boolean;
  onPick?: () => void;
}) {
  const inner = (
    <div className="flex items-center gap-3">
      <Crest abbr={game.away.abbr} logo={game.away.logo} className="size-11" />
      <span className="text-[11px] tracking-wide text-subtle uppercase">vs</span>
      <Crest abbr={game.home.abbr} logo={game.home.logo} className="size-11" />
      <div className="min-w-0 flex-1 text-center">
        <p className="truncate text-xs text-muted">
          {game.away.nick} · {game.home.nick}
        </p>
        <KickScore away={game.away.score} home={game.home.score} className="text-2xl" />
      </div>
      <span className="w-16 shrink-0 text-right text-[11px] tracking-wide text-subtle uppercase">
        {game.status === "in" ? game.clock ?? "Live" : game.status === "post" ? "Final" : game.statusText}
      </span>
    </div>
  );
  const cls = cn("block w-full rounded-xl bg-surface p-4 text-left", active && "shadow-[var(--shadow-border-hover)]");
  if (onPick) {
    return (
      <button type="button" onClick={onPick} className={cn(cls, "min-h-11")}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
