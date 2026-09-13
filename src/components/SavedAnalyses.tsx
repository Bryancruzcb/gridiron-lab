import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  browserStorage,
  createAnalysisStore,
  LOCAL_ONLY_NOTE,
  MAX_NAME_LENGTH,
  SAVED_ANALYSES_KEY,
  type AnalysisKind,
  type AnalysisStore,
  type SavedList,
  type SavedOf,
  type StoreResult,
} from "@/lib/analysis/storage";
import { cn } from "@/lib/utils";

export type SavedEvent<K extends AnalysisKind> =
  | { type: "saved" | "opened" | "renamed"; record: SavedOf<K> }
  | { type: "deleted"; id: string };

type Props<K extends AnalysisKind> = {
  kind: K;
  /** The analysis on screen, read when Save is pressed. */
  current: () => { state: unknown; datasetRef?: string };
  suggestedName: string;
  onOpen: (record: SavedOf<K>) => void;
  onEvent?: (event: SavedEvent<K>) => void;
  /** A note when a saved view refers to data this page no longer has. */
  datasetNote?: (record: SavedOf<K>) => string | null;
  className?: string;
};

type Status = { tone: "ok" | "error"; text: string };

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Save, open, rename and delete named views of one page, kept in this browser only. */
export function SavedAnalyses<K extends AnalysisKind>({ kind, current, suggestedName, onOpen, onEvent, datasetNote, className }: Props<K>) {
  const [store, setStore] = useState<AnalysisStore | null>(null);
  const [list, setList] = useState<StoreResult<SavedList<K>> | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  // Storage is read only after mount, so the server render and the first client render match.
  useEffect(() => {
    const s = createAnalysisStore({ storage: browserStorage() });
    setStore(s);
    setList(s.list(kind));
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === SAVED_ANALYSES_KEY) setList(s.list(kind));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [kind]);

  function settle<T>(result: StoreResult<T>, success: (value: T) => string) {
    if (store) setList(store.list(kind));
    setStatus(result.ok ? { tone: "ok", text: success(result.value) } : { tone: "error", text: result.error.message });
    return result.ok ? result.value : null;
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!store) return;
    const saved = settle(store.save({ kind, name: name.trim() || suggestedName, ...current() }), (r) => `Saved “${r.name}”.`);
    if (saved) {
      setName("");
      onEvent?.({ type: "saved", record: saved });
    }
  };

  const open = (id: string) => {
    if (!store) return;
    const record = settle(store.open(kind, id), (r) => `Opened “${r.name}”.`);
    if (record) {
      onOpen(record);
      onEvent?.({ type: "opened", record });
    }
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (!store || !renaming) return;
    const record = settle(store.rename(kind, renaming.id, renaming.name), (r) => `Renamed to “${r.name}”.`);
    if (record) {
      setRenaming(null);
      onEvent?.({ type: "renamed", record });
    }
  };

  const remove = (id: string, label: string) => {
    if (!store) return;
    if (settle(store.delete(id), () => `Deleted “${label}”.`) !== null) onEvent?.({ type: "deleted", id });
  };

  const clearAll = () => {
    if (!store) return;
    settle(store.clear(), () => "Cleared the saved views in this browser.");
    setConfirmClear(false);
  };

  const error = list && !list.ok ? list.error : null;
  const recoverable = error?.code === "corrupt" || error?.code === "unsupported-version";
  const items = list?.ok ? list.value.analyses : [];
  const skipped = list?.ok ? list.value.skipped : 0;
  const canSave = store !== null && list !== null && list.ok;

  return (
    <section
      data-testid="saved-analyses"
      data-kind={kind}
      data-ready={String(list !== null)}
      data-error={error?.code}
      className={cn("rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-display text-lg uppercase tracking-[0.06em]">Saved views</h2>
        <p className="text-xs text-subtle">{LOCAL_ONLY_NOTE}</p>
      </div>

      <form onSubmit={save} className="mt-3 flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggestedName}
          maxLength={MAX_NAME_LENGTH}
          aria-label="Name for this view"
          disabled={!canSave}
          className="h-9 min-w-0 flex-1 text-[13px]"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={!canSave}>
          Save view
        </Button>
      </form>

      {error && (
        <div role="alert" className="mt-3 rounded-md bg-rust/10 p-3 text-sm text-rust" data-testid="saved-error">
          <p>{error.message}</p>
          {recoverable && !confirmClear && (
            <button type="button" onClick={() => setConfirmClear(true)} className="mt-2 text-xs underline underline-offset-2">
              Start over
            </button>
          )}
        </div>
      )}
      {skipped > 0 && (
        <p className="mt-3 text-xs text-muted">
          {skipped === 1 ? "1 saved view" : `${skipped} saved views`} in this browser could not be read and {skipped === 1 ? "is" : "are"} hidden.{" "}
          {!confirmClear && (
            <button type="button" onClick={() => setConfirmClear(true)} className="underline underline-offset-2">
              Start over
            </button>
          )}
        </p>
      )}
      {confirmClear && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Delete every saved view in this browser, for every page?</span>
          <Button type="button" variant="destructive" size="sm" onClick={clearAll}>
            Delete all
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
            Keep them
          </Button>
        </div>
      )}

      {list === null ? (
        <p className="mt-3 text-xs text-muted">Reading saved views…</p>
      ) : list.ok && items.length === 0 ? (
        <p className="mt-3 text-xs text-muted">No saved views yet.</p>
      ) : (
        <ul data-testid="saved-list" className="mt-3 divide-y divide-border">
          {items.map((item) => {
            const note = datasetNote?.(item) ?? null;
            const editing = renaming?.id === item.id;
            return (
              <li key={item.id} data-saved-id={item.id} className="py-2">
                {editing ? (
                  <form onSubmit={rename} className="flex gap-2">
                    <Input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: item.id, name: e.target.value })}
                      maxLength={MAX_NAME_LENGTH}
                      aria-label={`New name for ${item.name}`}
                      className="h-9 min-w-0 flex-1 text-[13px]"
                    />
                    <Button type="submit" variant="secondary" size="sm">
                      Save name
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm" data-saved-name>
                        {item.name}
                      </p>
                      <p className="text-xs text-subtle">
                        {when(item.updatedAt)}
                        {note ? <span className="text-rust"> · {note}</span> : null}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button type="button" variant="secondary" size="sm" onClick={() => open(item.id)} aria-label={`Open ${item.name}`}>
                        Open
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming({ id: item.id, name: item.name })} aria-label={`Rename ${item.name}`}>
                        Rename
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => remove(item.id, item.name)} aria-label={`Delete ${item.name}`}>
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p role="status" aria-live="polite" data-testid="saved-status" className={cn("mt-2 text-xs", status?.tone === "error" ? "text-rust" : "text-muted", !status && "sr-only")}>
        {status?.text ?? ""}
      </p>
    </section>
  );
}
