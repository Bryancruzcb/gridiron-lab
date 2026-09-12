// Content hashing and canonical JSON. Semantic identities hash canonical JSON, so key order
// in source objects never changes a hash.

import { createHash } from "node:crypto";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * JSON with object keys sorted at every level. Non-finite numbers and undefined array items
 * throw instead of silently becoming null; undefined object properties are omitted.
 */
export function canonicalJson(value: unknown): string {
  return write(value, "$");
}

function write(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`${path}: cannot hash non-finite number ${value}`);
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value
          .map((item, i) => {
            if (item === undefined) throw new TypeError(`${path}[${i}]: undefined array item`);
            return write(item, `${path}[${i}]`);
          })
          .join(",")}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${write(v, `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`${path}: cannot hash a ${typeof value}`);
  }
}

export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Source text with CRLF folded to LF, for hashing code files identically on Windows and Linux checkouts. */
export function sha256OfText(text: string): string {
  return sha256Hex(text.replace(/\r\n/g, "\n"));
}
