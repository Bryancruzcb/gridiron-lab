import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FantasyPlayer } from "@/data/types";
import { selectionKey, type SelectionLink } from "../analysis/state.ts";
import {
  actualsVersion,
  autoRunKey,
  emptySelection,
  initialLineupState,
  lineupReducer,
  parseSelection,
  planCompare,
  planLineup,
  viewChannel,
  type Channel,
  type DataVersion,
  type LineupData,
  type LineupMode,
  type LineupSelection,
  type Pending,
} from "./selection.ts";
import { parseWorkerResponse, PROTOCOL_VERSION, type SolveJob, type WorkerRequest } from "./worker-protocol.ts";

/** Last selection used on the route in this tab. In memory only, and used only when the URL carries no selection. */
const MEMORY_KEY = "__gridironLabLineupSelection";

type MemoryWindow = Window & { [MEMORY_KEY]?: unknown };

type Slot = { worker: Worker | null; inflight: Pending | null };

export type SelectionWrite = "push" | "replace";

export type LineupSolverInput = {
  players: readonly FantasyPlayer[];
  cap: number;
  actuals: ReadonlyMap<string, number> | null;
  slate: string;
  /** The selection the URL carries, or null when it carries none. The URL is the source of truth. */
  link?: SelectionLink | null;
  /** Called when the selection changes other than by following the URL, so the page can write it there. */
  onSelectionChange?: (selection: LineupSelection, how: SelectionWrite) => void;
};

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Owns the lineup page's solves: one module worker per channel (lineup, compare), created on
 * demand after mount and terminated to cancel. Monotonic request ids plus fingerprints decide
 * which replies may land; the reducer checks them again.
 */
export function useLineupSolver({ players, cap, actuals, slate, link = null, onSelectionChange }: LineupSolverInput) {
  const data = useMemo<LineupData>(() => ({ players, cap, actuals }), [players, cap, actuals]);
  const version = useMemo<DataVersion>(() => ({ slate, actuals: actualsVersion(actuals) }), [slate, actuals]);
  const [state, dispatch] = useReducer(lineupReducer, version, initialLineupState);
  const [restored, setRestored] = useState(false);

  const lineupPlan = useMemo(() => planLineup(state.selection, data), [state.selection, data]);
  const comparePlan = useMemo(() => planCompare(data), [data]);
  const compareFingerprint = comparePlan?.fingerprint ?? null;

  const slots = useRef<Record<Channel, Slot>>({
    lineup: { worker: null, inflight: null },
    compare: { worker: null, inflight: null },
  });
  const lastId = useRef(0);
  const plans = useRef({ lineup: lineupPlan, compare: comparePlan });

  // URL sync. `urlKey` is the selection the URL shows as far as this hook knows (undefined before
  // mount); `written` holds keys this hook navigated to that the router has not reported back yet.
  const linkRef = useRef(link);
  const onChangeRef = useRef(onSelectionChange);
  const urlKey = useRef<string | undefined>(undefined);
  const written = useRef<string[]>([]);
  const writeHow = useRef<SelectionWrite>("push");
  const shownSelection = useRef(state.selection);

  const terminate = useCallback((channel: Channel) => {
    const slot = slots.current[channel];
    slot.worker?.terminate();
    slot.worker = null;
    slot.inflight = null;
  }, []);

  const spawn = useCallback(
    (channel: Channel) => {
      const slot = slots.current[channel];
      const worker = new Worker(new URL("../../workers/optimizer.worker.ts", import.meta.url), {
        type: "module",
        name: `lineup-${channel}`,
      });
      const failInflight = (code: string, message: string) => {
        const inflight = slot.inflight;
        terminate(channel);
        if (inflight) dispatch({ type: "request-failure", channel, ...inflight, code, message });
      };
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (slot.worker !== worker) return;
        const parsed = parseWorkerResponse(event.data);
        if (!parsed.ok) return failInflight("malformed-response", `The optimizer worker sent an unreadable reply: ${parsed.message}.`);
        const reply = parsed.response;
        if (reply.type === "result" && reply.outcome.kind !== channel)
          return failInflight("malformed-response", `The optimizer worker answered a ${channel} request with a ${reply.outcome.kind} result.`);
        const inflight = slot.inflight;
        // A worker handles one request at a time, so an error it could not tie to an id is this one's.
        if (reply.type === "error" && reply.requestId === null) return failInflight(reply.code, reply.message);
        if (!inflight || reply.requestId !== inflight.requestId || reply.fingerprint !== inflight.fingerprint) return;
        slot.inflight = null;
        if (reply.type === "result")
          dispatch({ type: "request-result", requestId: reply.requestId, fingerprint: reply.fingerprint, outcome: reply.outcome, elapsedMs: reply.elapsedMs });
        else dispatch({ type: "request-failure", channel, ...inflight, code: reply.code, message: reply.message });
      };
      worker.onmessageerror = () => {
        if (slot.worker === worker) failInflight("malformed-response", "The optimizer worker sent a reply that could not be read.");
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        if (slot.worker === worker) failInflight("worker-crashed", event.message || "The optimizer worker stopped before it replied.");
      };
      return worker;
    },
    [terminate],
  );

  const start = useCallback(
    (channel: Channel, plan: { fingerprint: string; job: SolveJob }) => {
      const slot = slots.current[channel];
      // Superseded work is stopped, not just ignored: a busy worker cannot read a cancel message.
      if (slot.inflight) terminate(channel);
      const pending: Pending = { requestId: ++lastId.current, fingerprint: plan.fingerprint };
      dispatch({ type: "request-start", channel, ...pending });
      try {
        slot.worker ??= spawn(channel);
      } catch (err) {
        dispatch({
          type: "request-failure",
          channel,
          ...pending,
          code: "worker-unavailable",
          message: `The optimizer worker could not start (${errorText(err)}).`,
        });
        return;
      }
      slot.inflight = pending;
      const request: WorkerRequest = { type: "solve", protocol: PROTOCOL_VERSION, ...pending, job: plan.job };
      try {
        slot.worker.postMessage(request);
      } catch (err) {
        terminate(channel);
        dispatch({ type: "request-failure", channel, ...pending, code: "worker-post-failed", message: `The solve request could not be sent (${errorText(err)}).` });
      }
    },
    [spawn, terminate],
  );

  const cancel = useCallback(
    (channel: Channel) => {
      const inflight = slots.current[channel].inflight;
      if (!inflight) return;
      terminate(channel);
      dispatch({ type: "cancel", channel, requestId: inflight.requestId });
    },
    [terminate],
  );

  // Refs first, so the effects below read this commit's plans and link.
  useEffect(() => {
    plans.current = { lineup: lineupPlan, compare: comparePlan };
    linkRef.current = link;
    onChangeRef.current = onSelectionChange;
  });

  // URL -> selection. On mount a link wins; without one the in-memory selection is restored. Later,
  // a URL this hook did not write (back/forward, an opened saved view) is imported like a restore.
  const linkKey = link?.key ?? null;
  useEffect(() => {
    const current = linkRef.current;
    const key = current?.key ?? selectionKey(emptySelection(slate));
    const mounting = urlKey.current === undefined;
    urlKey.current = key;
    if (mounting) {
      if (current) dispatch({ type: "import", raw: current.raw, source: "link" });
      else {
        const raw = (window as MemoryWindow)[MEMORY_KEY];
        if (raw !== undefined) {
          if (parseSelection(raw, slate).ok) writeHow.current = "replace";
          dispatch({ type: "import", raw, source: "memory" });
        }
      }
      setRestored(true);
      return;
    }
    const mine = written.current.indexOf(key);
    if (mine >= 0) {
      written.current.splice(0, mine + 1);
      return;
    }
    if (key === selectionKey(shownSelection.current)) return;
    dispatch({ type: "import", raw: current ? current.raw : emptySelection(slate), source: "link" });
  }, [linkKey, slate]);

  // Selection -> URL, for every change that did not come from the URL itself.
  useEffect(() => {
    if (state.selection === shownSelection.current) return;
    shownSelection.current = state.selection;
    const how = writeHow.current;
    writeHow.current = "push";
    const key = selectionKey(state.selection);
    if (key === urlKey.current) return;
    urlKey.current = key;
    written.current = [...written.current.slice(-19), key];
    onChangeRef.current?.(state.selection, how);
  }, [state.selection]);

  useEffect(() => {
    if (restored) (window as MemoryWindow)[MEMORY_KEY] = state.selection;
  }, [restored, state.selection]);

  useEffect(() => {
    dispatch({ type: "data", data: version });
  }, [version]);

  useEffect(
    () => () => {
      terminate("lineup");
      terminate("compare");
    },
    [terminate],
  );

  // Work for a configuration that is no longer active is cancelled.
  useEffect(() => {
    const inflight = slots.current.lineup.inflight;
    if (inflight && inflight.fingerprint !== lineupPlan.fingerprint) cancel("lineup");
  }, [lineupPlan.fingerprint, cancel]);

  const autoKey = autoRunKey(state);
  useEffect(() => {
    if (!restored) return;
    const plan = plans.current.lineup;
    if (plan.ok) start("lineup", plan);
  }, [autoKey, restored, start]);

  useEffect(() => {
    if (!restored) return;
    const plan = plans.current.compare;
    if (plan) start("compare", plan);
    else cancel("compare");
  }, [compareFingerprint, restored, start, cancel]);

  const run = useCallback(() => {
    const plan = plans.current.lineup;
    if (plan.ok) start("lineup", plan);
  }, [start]);

  const retryCompare = useCallback(() => {
    const plan = plans.current.compare;
    if (plan) start("compare", plan);
  }, [start]);

  return {
    selection: state.selection,
    importReport: state.importReport,
    lineupPlan,
    lineup: viewChannel(state.lineup, lineupPlan.fingerprint),
    compare: viewChannel(state.compare, compareFingerprint),
    run,
    cancel: useCallback(() => cancel("lineup"), [cancel]),
    retryCompare,
    toggleLock: useCallback((id: string) => dispatch({ type: "toggle-lock", id }), []),
    toggleExclude: useCallback((id: string) => dispatch({ type: "toggle-exclude", id }), []),
    setStack: useCallback((stack: boolean) => dispatch({ type: "set-stack", stack }), []),
    setMode: useCallback((mode: LineupMode) => dispatch({ type: "set-mode", mode }), []),
    reset: useCallback(() => dispatch({ type: "reset" }), []),
    importSelection: useCallback((raw: unknown, source: string) => dispatch({ type: "import", raw, source }), []),
    dismissImport: useCallback(() => dispatch({ type: "dismiss-import" }), []),
  };
}
