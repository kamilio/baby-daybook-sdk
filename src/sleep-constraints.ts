import type { SleepDurationConstraint } from "./types.js";

const LOOSEN_PERCENT = 10;
const ADJUSTMENT_INTERVAL_MINUTES = 5;
const MAX_ADJUSTMENT_MINUTES = 30;

export function loosenSleepDurationConstraint(constraint: Readonly<SleepDurationConstraint>): SleepDurationConstraint {
  assertConstraint(constraint);
  return {
    minimumMinutes: constraint.minimumMinutes - adjustmentMinutes(constraint.minimumMinutes),
    maximumMinutes: constraint.maximumMinutes + adjustmentMinutes(constraint.maximumMinutes),
  };
}

export function clampSleepDurationToLooseConstraint(
  durationMinutes: number,
  constraint: Readonly<SleepDurationConstraint>,
): number {
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
    throw new RangeError("durationMinutes must be a non-negative finite number");
  }
  const loose = loosenSleepDurationConstraint(constraint);
  return Math.min(loose.maximumMinutes, Math.max(loose.minimumMinutes, durationMinutes));
}

function adjustmentMinutes(durationMinutes: number): number {
  const percentAdjustment = Math.round(durationMinutes * LOOSEN_PERCENT / 100);
  const rounded = Math.round(percentAdjustment / ADJUSTMENT_INTERVAL_MINUTES) * ADJUSTMENT_INTERVAL_MINUTES;
  return Math.min(rounded, MAX_ADJUSTMENT_MINUTES);
}

function assertConstraint(constraint: Readonly<SleepDurationConstraint>): void {
  if (!Number.isFinite(constraint.minimumMinutes) || constraint.minimumMinutes < 0) {
    throw new RangeError("minimumMinutes must be a non-negative finite number");
  }
  if (!Number.isFinite(constraint.maximumMinutes) || constraint.maximumMinutes < constraint.minimumMinutes) {
    throw new RangeError("maximumMinutes must be finite and not less than minimumMinutes");
  }
}
