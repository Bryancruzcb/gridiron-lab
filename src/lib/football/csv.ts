// RFC 4180 CSV parsing plus typed, validated column access. Pure; Node tests import it directly.

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

export class CsvColumnError extends Error {
  readonly missing: readonly string[];
  constructor(source: string, missing: readonly string[]) {
    super(`${source}: missing required column(s): ${missing.join(", ")}`);
    this.name = "CsvColumnError";
    this.missing = missing;
  }
}

export class CsvValueError extends Error {
  constructor(source: string, line: number, column: string, value: string) {
    super(`${source}: record ${line} column ${column}: expected a number, got ${JSON.stringify(value)}`);
    this.name = "CsvValueError";
  }
}

// A quote opens a quoted field only at the start of a field; elsewhere it is a literal character.
function parseRecords(text: string, strict: boolean): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let fieldStart = true;
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endCell = () => {
    row.push(cell);
    cell = "";
    fieldStart = true;
  };

  while (i < n) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += c;
      }
      i += 1;
      continue;
    }
    if (c === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (c === ",") {
      endCell();
    } else if (c === "\n" || c === "\r") {
      endCell();
      rows.push(row);
      row = [];
      if (c === "\r" && text[i + 1] === "\n") i += 1;
    } else {
      cell += c;
      fieldStart = false;
    }
    i += 1;
  }
  if (quoted && strict) throw new CsvFormatError("unterminated quoted field");
  if (cell !== "" || row.length > 0 || !fieldStart) {
    endCell();
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Parses a whole document: quoted commas, doubled quotes, CRLF or LF, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  return parseRecords(text, true);
}

/** One physical line, leniently (an unterminated quote runs to the end of the line). */
export function parseCsvLine(line: string): string[] {
  return parseRecords(line, false)[0] ?? [""];
}

export function normalizeHeader(name: string): string {
  return (name.charCodeAt(0) === 0xfeff ? name.slice(1) : name)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

const MISSING = new Set(["", "NA", "NaN", "null", "NULL"]);

/** Missing cells are null, never an empty string or zero. */
export function textCell(raw: string | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim();
  return MISSING.has(v) ? null : v;
}

export type CsvRow<C extends string> = {
  /** 1-based record number; the header is record 1. */
  line: number;
  text(column: C): string | null;
  /** null for a missing cell; throws CsvValueError for text that is not a number. */
  num(column: C): number | null;
};

export type CsvTable<C extends string> = {
  source: string;
  header: string[];
  rows: CsvRow<C>[];
};

/**
 * Reads a CSV with a header row. Every required column must be present after header
 * normalization or this throws, so a renamed upstream column cannot quietly become zeros.
 */
export function readCsv<C extends string>(text: string, required: readonly C[], source = "csv"): CsvTable<C> {
  const records = parseCsv(text);
  const rawHeader = records[0];
  if (!rawHeader) throw new CsvColumnError(source, required);
  const header = rawHeader.map(normalizeHeader);
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    if (!index.has(h)) index.set(h, i);
  });
  const missing = required.filter((c) => !index.has(normalizeHeader(c)));
  if (missing.length) throw new CsvColumnError(source, missing);

  const rows = records.slice(1).map((cells, r): CsvRow<C> => {
    const line = r + 2;
    const raw = (column: C) => {
      const i = index.get(normalizeHeader(column));
      return i == null ? undefined : cells[i];
    };
    return {
      line,
      text: (column) => textCell(raw(column)),
      num: (column) => {
        const v = textCell(raw(column));
        if (v == null) return null;
        const x = Number(v);
        if (!Number.isFinite(x)) throw new CsvValueError(source, line, column, v);
        return x;
      },
    };
  });
  return { source, header, rows };
}
