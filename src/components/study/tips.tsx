/** Chart tooltips for Study sections. */
export function GuessTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { week: number; proj: number; actual: number } }>;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3 py-2.5 text-sm text-fg shadow-[var(--shadow-border-hover)]">
      <p className="font-medium">Week {d.week}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Thought</dt>
        <dd>{d.proj.toFixed(1)}</dd>
        <dt className="text-muted">Scored</dt>
        <dd>{d.actual.toFixed(1)}</dd>
      </dl>
    </div>
  );
}

export function AlphaTip({
  active,
  payload,
  trail,
}: {
  active?: boolean;
  payload?: Array<{ payload: { alpha: number; lineupMean: number; mae: number } }>;
  trail: number;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3 py-2.5 text-sm text-fg shadow-[var(--shadow-border-hover)]">
      <p className="font-medium">Last-week weight {d.alpha.toFixed(2)}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Team score</dt>
        <dd>{d.lineupMean.toFixed(1)}</dd>
        <dt className="text-muted">Miss / player</dt>
        <dd>{d.mae.toFixed(2)}</dd>
        <dt className="text-muted">Season avg</dt>
        <dd>{trail.toFixed(1)}</dd>
      </dl>
    </div>
  );
}

export function LagTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { name: string; team: string; week: number; epaPrev: number; epaNext: number; attNext: number; cpoePrev: number | null };
  }>;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3 py-2.5 text-sm text-fg shadow-[var(--shadow-border-hover)]">
      <p className="font-medium">{d.name}</p>
      <p className="text-xs text-muted">
        {d.team} · week {d.week}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Last EPA</dt>
        <dd>{d.epaPrev.toFixed(2)}</dd>
        <dt className="text-muted">This EPA</dt>
        <dd>{d.epaNext.toFixed(2)}</dd>
        <dt className="text-muted">Attempts</dt>
        <dd>{d.attNext}</dd>
      </dl>
    </div>
  );
}
