import type { SplitStats } from "@/data/types";
import type { QbSeason } from "@/data/types";

/** Chart text and the good/bad colours (the --color-up / --color-down tokens), bright enough to read on the plot. */
export const INK = "#D3D5CF";
export const INK_QUIET = "#A5A7A1";
export const UP = "#9FCB9F";
export const DOWN = "#EE9784";
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
