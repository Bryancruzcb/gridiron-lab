/** A source file is absent, altered, unreadable or does not match its pin. */
export class StudyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyInputError";
  }
}

/** A model, universe or run configuration is invalid. */
export class StudyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyConfigError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
