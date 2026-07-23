import { isNativeTrue } from "./native-flags.js";
import type { DailyAction } from "./types.js";

export interface ActivityRangeOptions {
  fromMillis: number;
  toMillis: number;
  nowMillis?: number;
  types?: readonly string[];
  includeDeleted?: boolean;
}

export function listActivitiesForRange(
  activities: readonly DailyAction[],
  durationTypeUids: readonly string[],
  options: ActivityRangeOptions,
): DailyAction[] {
  validateRange(options);
  const durationTypes = new Set(durationTypeUids);
  const selectedTypes = options.types ? new Set(options.types) : undefined;
  const nowMillis = options.nowMillis ?? Date.now();
  return activities
    .filter((activity) => {
      if (!options.includeDeleted && activity.deleted) return false;
      if (selectedTypes && !selectedTypes.has(activity.type)) return false;
      if (activity.startMillis >= options.fromMillis && activity.startMillis <= options.toMillis) return true;
      if (!durationTypes.has(activity.type) || activity.startMillis >= options.fromMillis) return false;
      return (activity.endMillis !== undefined && activity.endMillis > options.fromMillis)
        || (isNativeTrue(activity.inProgress) && nowMillis > options.fromMillis);
    })
    .sort((left, right) => right.startMillis - left.startMillis
      || left.type.localeCompare(right.type)
      || left.uid.localeCompare(right.uid));
}

export function countActivitiesForRange(
  activities: readonly DailyAction[],
  durationTypeUids: readonly string[],
  options: ActivityRangeOptions,
): number {
  return listActivitiesForRange(activities, durationTypeUids, options).length;
}

function validateRange(options: ActivityRangeOptions): void {
  if (!Number.isFinite(options.fromMillis) || !Number.isFinite(options.toMillis)) throw new RangeError("Activity range boundaries must be finite");
  if (options.fromMillis > options.toMillis) throw new RangeError("Activity range start must not be after its end");
  if (options.nowMillis !== undefined && !Number.isFinite(options.nowMillis)) throw new RangeError("Current activity time must be finite");
}
