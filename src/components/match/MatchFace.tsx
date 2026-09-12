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
    <img
      src={logo || teamLogo(abbr)}
      alt=""
      className={cn("shrink-0 object-contain", className ?? "size-10")}
    />
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
    <span className="inline-flex items-center gap-1.5 rounded-full bg-fg/15 px-3 py-1 text-[11px] font-medium tracking-wide text-fg uppercase">
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
      <span className="text-fg/50">:</span>
      {home}
    </p>
  );
}

function Side({ side, big }: { side: TeamSide; big?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <Crest abbr={side.abbr} logo={side.logo} className={big ? "size-16" : "size-10"} />
      <p className={cn("truncate text-center font-medium", big ? "text-sm" : "text-xs")}>{side.nick}</p>
    </div>
  );
}

export function MatchHero({ game }: { game: LiveGame }) {
  const wash = teamColor(game.home.abbr);
  return (
    <div
      className="relative overflow-hidden rounded-xl px-5 py-7 text-fg shadow-[var(--shadow-border)]"
      style={{
        background: `linear-gradient(165deg, ${wash} 0%, color-mix(in oklab, ${wash} 40%, var(--color-bg)) 58%, var(--color-bg) 100%)`,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <LivePill live={game.status === "in"} clock={game.clock} />
        <span className="text-[11px] tracking-[0.14em] text-fg/70 uppercase">{game.statusText}</span>
      </div>
      <div className="mt-8 flex items-center gap-2">
        <Side side={game.away} big />
        <KickScore away={game.away.score} home={game.home.score} className="text-6xl sm:text-7xl" />
        <Side side={game.home} big />
      </div>
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
    <>
      <div className="flex items-center justify-between gap-2">
        <LivePill live={game.status === "in"} clock={game.clock} />
        <span className="text-[11px] tracking-wide text-subtle uppercase">
          {game.status === "in" ? game.statusText : game.stage === "advanced" ? "Advanced" : game.statusText}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Crest abbr={game.away.abbr} logo={game.away.logo} className="size-8" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{game.away.nick}</span>
        <KickScore away={game.away.score} home={game.home.score} className="text-2xl" />
        <span className="min-w-0 flex-1 truncate text-right text-sm font-medium">{game.home.nick}</span>
        <Crest abbr={game.home.abbr} logo={game.home.logo} className="size-8" />
      </div>
    </>
  );
  const cls = cn(
    "block w-full rounded-xl bg-surface p-4 text-left shadow-[var(--shadow-border)]",
    active && "shadow-[var(--shadow-border-hover)]",
  );
  if (onPick) {
    return (
      <button type="button" onClick={onPick} className={cn(cls, "min-h-11")}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
