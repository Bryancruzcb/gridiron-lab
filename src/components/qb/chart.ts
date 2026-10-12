import type { SplitStats } from "@/data/types";
import type { QbSeason } from "@/data/types";

/** Chart text and the good/bad colours: the theme tokens, so the plot follows light and dark. */
export const INK = "var(--color-fg)";
export const INK_QUIET = "var(--color-muted)";
export const UP = "var(--color-up)";
export const DOWN = "var(--color-down)";
/** Up to this many quarterbacks in the slice, every one is drawn as a photo with a name. */
export const LABEL_ALL = 12;

export type PinItem =
  | { kind: "row"; id: string; qb: QbSeason; stats: SplitStats }
  | { kind: "unresolved"; id: string; pending: boolean; name: string | null; note: string };
export type PinRow = Extract<PinItem, { kind: "row" }>;

export type ScatterPoint = {
  id: string;
  name: string;
  last: string;
  team: string;
  headshot: string | null;
  epa: number;
  cpoe: number;
  plays: number;
  pinned: boolean;
  photo: boolean;
  label: boolean;
  flip: boolean;
  r: number;
};
