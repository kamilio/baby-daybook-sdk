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
