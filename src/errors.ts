import type { BabyDaybookRestoreOutcome } from "./types.js";

export class BabyDaybookError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, options: { status?: number; code?: string; details?: unknown; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "BabyDaybookError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

export class BabyDaybookAuthError extends BabyDaybookError {
  constructor(message: string, options: { status?: number; code?: string; details?: unknown; cause?: unknown } = {}) {
    super(message, options);
    this.name = "BabyDaybookAuthError";
  }
}

export class BabyDaybookApiError extends BabyDaybookError {
  constructor(message: string, options: { status?: number; code?: string; details?: unknown; cause?: unknown } = {}) {
    super(message, options);
    this.name = "BabyDaybookApiError";
  }
}

export class BabyDaybookRestoreError extends BabyDaybookError {
  readonly outcomes: readonly BabyDaybookRestoreOutcome[];
  readonly errors: readonly unknown[];

  constructor(outcomes: readonly BabyDaybookRestoreOutcome[]) {
    const snapshot = outcomes.map((outcome) => ({ ...outcome, target: { ...outcome.target } }));
    const errors = snapshot.flatMap((outcome) => outcome.status === "rejected" ? [outcome.reason] : []);
    const cause = errors[0];
    const detail = cause instanceof Error ? cause.message : "Unknown restore error";
    super(`Backup restore failed after all started operations settled: ${detail}. Inspect outcomes before retrying.`, {
      code: "BACKUP_RESTORE_FAILED", cause, details: { outcomes: snapshot },
    });
    this.name = "BabyDaybookRestoreError";
    this.outcomes = snapshot;
    this.errors = errors;
  }
}
