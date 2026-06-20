import type { DailyAction } from "./types.js";

export const BABY_DAYBOOK_ACTIVITY_FUTURE_GRACE_MILLIS = 60_000;

export interface LastActivityOptions {
  groupUid?: string;
  atMillis?: number;
}

export interface ActivityAmount {
  amount: number;
  amountUnit?: string;
}

export function getLastActivity(
  activities: readonly DailyAction[],
  type: string,
  options: LastActivityOptions = {},
): DailyAction | undefined {
  const cutoff = (options.atMillis ?? Date.now()) + BABY_DAYBOOK_ACTIVITY_FUTURE_GRACE_MILLIS;
  return sortNewestFirst(activities.filter((activity) =>
    !activity.deleted
    && activity.type === type
    && activity.startMillis <= cutoff
    && (options.groupUid === undefined || activity.groupUid === options.groupUid)))[0];
}

export function getLastActivities(
  activities: readonly DailyAction[],
  types?: readonly string[],
  atMillis = Date.now(),
): DailyAction[] {
  const cutoff = atMillis + BABY_DAYBOOK_ACTIVITY_FUTURE_GRACE_MILLIS;
  const includedTypes = types ? new Set(types) : undefined;
  const latest = new Map<string, DailyAction>();
  for (const activity of sortNewestFirst(activities)) {
    if (activity.deleted || activity.startMillis >= cutoff || (includedTypes && !includedTypes.has(activity.type))) continue;
    if (!latest.has(activity.type)) latest.set(activity.type, activity);
  }
  return [...latest.values()];
}

export function getInProgressActivities(activities: readonly DailyAction[], types?: readonly string[]): DailyAction[] {
  const includedTypes = types ? new Set(types) : undefined;
  const latest = new Map<string, DailyAction>();
  for (const activity of sortNewestFirst(activities)) {
    if (activity.deleted || activity.inProgress !== true || (includedTypes && !includedTypes.has(activity.type))) continue;
    if (!latest.has(activity.type)) latest.set(activity.type, activity);
  }
  return [...latest.values()];
}

export function findOverlappingActivities(
  activities: readonly DailyAction[],
  candidate: Pick<DailyAction, "uid" | "type" | "startMillis" | "endMillis" | "inProgress">,
  atMillis = Date.now(),
): DailyAction[] {
  const candidateEnd = candidate.endMillis ?? (candidate.inProgress ? atMillis : candidate.startMillis);
  return activities.filter((activity) => {
    if (activity.deleted || activity.uid === candidate.uid || activity.type !== candidate.type) return false;
    const startsInside = activity.startMillis >= candidate.startMillis && activity.startMillis <= candidateEnd;
    const spansStart = activity.startMillis < candidate.startMillis
      && (activity.inProgress === true || (activity.endMillis !== undefined && activity.endMillis > candidate.startMillis));
    return startsInside || spansStart;
  });
}

export function getLastAmountForGroup(
  activities: readonly DailyAction[],
  type: string,
  groupUid: string,
): ActivityAmount | undefined {
  const activity = sortNewestFirst(activities.filter((item) =>
    !item.deleted && item.type === type && item.groupUid === groupUid))[0];
  return activity?.amount === undefined ? undefined : { amount: activity.amount, amountUnit: activity.amountUnit };
}

function sortNewestFirst(activities: readonly DailyAction[]): DailyAction[] {
  return [...activities].sort((left, right) => right.startMillis - left.startMillis || left.uid.localeCompare(right.uid));
}
