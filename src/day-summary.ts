import { listActivitiesForRange } from "./timeline.js";
import type { ActivityGroup, ActivitySide, ActivityType, DailyAction } from "./types.js";

export interface DayActivityTypeSummaryOptions {
  fromMillis: number;
  toMillis: number;
  nowMillis?: number;
  includeDeleted?: boolean;
}

export interface DayActivityTypeSummaryAmountByGroup {
  groupUid?: string;
  groupTitle: string;
  amountUnit?: string;
  amount: number;
  count: number;
}

export interface DayActivityTypeSummaryAmountByUnit {
  amountUnit?: string;
  amount: number;
  count: number;
}

export interface DayActivityTypeSummary {
  activityType: ActivityType;
  activityCount: number;
  leftDurationMillis: number;
  rightDurationMillis: number;
  durationMillis: number;
  volume: number;
  leftVolume: number;
  rightVolume: number;
  peeCount: number;
  pooCount: number;
  hairWashCount: number;
  maxTemperature: number;
  amountByGroup: DayActivityTypeSummaryAmountByGroup[];
  amountByUnit: DayActivityTypeSummaryAmountByUnit[];
  inProgressActivity?: DailyAction;
  lastSide?: ActivitySide;
  lastGroupUid?: string;
  lastGroupTitle?: string;
  lastAmountUnit?: string;
}

const SIDE_DURATION_TYPES = new Set(["breastfeeding", "pump"]);
const VOLUME_TYPES = new Set(["pump", "bottle", "drink"]);
const ELIMINATION_TYPES = new Set(["diaper_change", "potty"]);

export function buildDayActivityTypeSummaries(
  activityTypes: readonly ActivityType[],
  activities: readonly DailyAction[],
  groups: readonly ActivityGroup[],
  options: DayActivityTypeSummaryOptions,
  configuredTypeUids: readonly string[] = [],
): DayActivityTypeSummary[] {
  const activeTypes = activityTypes.filter((activityType) => options.includeDeleted || !activityType.deleted);
  const typeMap = new Map(activeTypes.map((activityType) => [activityType.uid, activityType]));
  const orderedTypes = configuredTypeUids.length
    ? unique(configuredTypeUids).flatMap((uid) => {
      const activityType = typeMap.get(uid);
      return activityType ? [activityType] : [];
    })
    : activeTypes;
  const selectedActivities = listActivitiesForRange(
    activities,
    activeTypes.filter((activityType) => activityType.hasDuration).map((activityType) => activityType.uid),
    options,
  );
  const groupMap = new Map(groups
    .filter((group) => options.includeDeleted || !group.deleted)
    .map((group) => [group.uid, group]));
  const activitiesByType = new Map<string, DailyAction[]>();
  for (const activity of selectedActivities) {
    const list = activitiesByType.get(activity.type) ?? [];
    list.push(activity);
    activitiesByType.set(activity.type, list);
  }

  const summaries = orderedTypes.map((activityType) => {
    const summary = emptySummary(activityType);
    for (const activity of activitiesByType.get(activityType.uid) ?? []) {
      addActivity(summary, activity, groupMap.get(activity.groupUid ?? ""), options);
    }
    return summary;
  });
  const typeOrder = unique([
    ...selectedActivities.map((activity) => activity.type),
    ...orderedTypes.map((activityType) => activityType.uid),
  ]);
  const orderMap = new Map(typeOrder.map((uid, index) => [uid, index]));
  return summaries.sort((left, right) => (orderMap.get(left.activityType.uid) ?? -1) - (orderMap.get(right.activityType.uid) ?? -1));
}

function emptySummary(activityType: ActivityType): DayActivityTypeSummary {
  return {
    activityType,
    activityCount: 0,
    leftDurationMillis: 0,
    rightDurationMillis: 0,
    durationMillis: 0,
    volume: 0,
    leftVolume: 0,
    rightVolume: 0,
    peeCount: 0,
    pooCount: 0,
    hairWashCount: 0,
    maxTemperature: 0,
    amountByGroup: [],
    amountByUnit: [],
  };
}

function addActivity(
  summary: DayActivityTypeSummary,
  activity: DailyAction,
  group: ActivityGroup | undefined,
  options: DayActivityTypeSummaryOptions,
): void {
  const nowMillis = options.nowMillis ?? Date.now();
  const isInProgress = summary.activityType.hasDuration === true && activity.inProgress === true;
  const isCurrentRange = isSameLocalDate(options.fromMillis, nowMillis);
  if (activity.startMillis >= options.fromMillis && activity.startMillis <= options.toMillis) summary.activityCount += 1;
  if (isInProgress && isCurrentRange) summary.inProgressActivity = activity;

  if (summary.activityType.hasDuration) {
    if (SIDE_DURATION_TYPES.has(summary.activityType.uid)) {
      if (summary.lastSide === undefined) summary.lastSide = activity.side;
      if (!isInProgress || activity.side === "right") {
        summary.leftDurationMillis += activityDurationInRange(activity, options, "left");
      }
      if (!isInProgress || activity.side === "left") {
        summary.rightDurationMillis += activityDurationInRange(activity, options, "right");
      }
    } else if (!isInProgress || !isCurrentRange) {
      summary.durationMillis += activityDurationInRange(activity, options);
    }
  }

  if (ELIMINATION_TYPES.has(summary.activityType.uid)) {
    if (activity.pee) summary.peeCount += 1;
    if (activity.poo) summary.pooCount += 1;
  }
  if (summary.activityType.uid === "bath" && activity.hairWash) summary.hairWashCount += 1;
  if (summary.activityType.uid === "temperature") summary.maxTemperature = Math.max(summary.maxTemperature, activity.temperature ?? 0);

  if (VOLUME_TYPES.has(summary.activityType.uid)) {
    const volume = activity.volume ?? 0;
    summary.volume += volume;
    if (SIDE_DURATION_TYPES.has(summary.activityType.uid)) {
      if (activity.side === "left") summary.leftVolume += volume;
      else if (activity.side === "right") summary.rightVolume += volume;
      else {
        summary.leftVolume += volume / 2;
        summary.rightVolume += volume / 2;
      }
    }
    if (volume > 0) increaseAmountByGroup(summary, activity.groupUid, group?.title ?? "", volume);
  }

  if (summary.activityType.hasAmount && (activity.amount ?? 0) > 0) {
    const amount = activity.amount ?? 0;
    increaseAmountByGroup(summary, activity.groupUid, group?.title ?? "", amount, activity.amountUnit);
    increaseAmountByUnit(summary, activity.amountUnit, amount);
    if (summary.lastAmountUnit === undefined) summary.lastAmountUnit = activity.amountUnit;
  }
  if (summary.lastGroupUid === undefined) summary.lastGroupUid = activity.groupUid;
  if (summary.lastGroupTitle === undefined) summary.lastGroupTitle = group?.title;
}

function activityDurationInRange(
  activity: DailyAction,
  options: DayActivityTypeSummaryOptions,
  side?: "left" | "right",
): number {
  const nowMillis = options.nowMillis ?? Date.now();
  const inProgress = activity.inProgress === true;
  const endMillis = inProgress ? nowMillis : (activity.endMillis ?? activity.startMillis);
  const chronologicalDuration = endMillis - activity.startMillis;
  const effectiveDuration = inProgress
    ? Math.max(0, nowMillis - activity.startMillis - (activity.pauseMillis ?? 0))
    : SIDE_DURATION_TYPES.has(activity.type)
      ? Math.max(0, (activity.leftDuration ?? 0) + (activity.rightDuration ?? 0))
      : Math.max(0, activity.duration ?? chronologicalDuration);
  const overlapStart = Math.max(activity.startMillis, options.fromMillis);
  const overlapEnd = Math.min(endMillis, options.toMillis + 1);
  if (overlapStart > overlapEnd) return 0;
  const overlapRatio = chronologicalDuration === 0 ? 1 : Math.max(0, overlapEnd - overlapStart) / chronologicalDuration;
  let requestedDuration = effectiveDuration;
  if (side) {
    if (!inProgress) requestedDuration = side === "left" ? (activity.leftDuration ?? 0) : (activity.rightDuration ?? 0);
    else if (activity.side === "left") {
      const currentLeftDuration = Math.max(0, effectiveDuration - (activity.rightDuration ?? 0));
      requestedDuration = side === "left" ? currentLeftDuration : (activity.rightDuration ?? 0);
    } else if (activity.side === "right") {
      const currentRightDuration = Math.max(0, effectiveDuration - (activity.leftDuration ?? 0));
      requestedDuration = side === "right" ? currentRightDuration : (activity.leftDuration ?? 0);
    } else requestedDuration = side === "left" ? (activity.leftDuration ?? 0) : (activity.rightDuration ?? 0);
  }
  return Math.trunc(Math.max(0, requestedDuration) * overlapRatio);
}

function increaseAmountByGroup(
  summary: DayActivityTypeSummary,
  groupUid: string | undefined,
  groupTitle: string,
  amount: number,
  amountUnit?: string,
): void {
  let item = summary.amountByGroup.find((candidate) => candidate.groupUid === groupUid && candidate.amountUnit === amountUnit);
  if (!item) {
    item = { groupUid, groupTitle, amountUnit, amount: 0, count: 0 };
    summary.amountByGroup.push(item);
  }
  item.amount += amount;
  item.count += 1;
}

function increaseAmountByUnit(summary: DayActivityTypeSummary, amountUnit: string | undefined, amount: number): void {
  let item = summary.amountByUnit.find((candidate) => candidate.amountUnit === amountUnit);
  if (!item) {
    item = { amountUnit, amount: 0, count: 0 };
    summary.amountByUnit.push(item);
  }
  item.amount += amount;
  item.count += 1;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isSameLocalDate(leftMillis: number, rightMillis: number): boolean {
  const left = new Date(leftMillis);
  const right = new Date(rightMillis);
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
