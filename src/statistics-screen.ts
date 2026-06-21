import type { ActivityType, DailyAction } from "./types.js";

export type StatisticsTabDataType =
  | "numberOfTimes"
  | "duration"
  | "temperature"
  | "volume"
  | "amount"
  | "reaction"
  | "timeOfDay";

export interface StatisticsActivityTypeItem {
  activityType: ActivityType;
  activityCount: number;
  tabs: StatisticsTabDataType[];
}

export interface StatisticsScreenData {
  items: StatisticsActivityTypeItem[];
  selectedItem?: StatisticsActivityTypeItem;
}

const VOLUME_TYPES = new Set(["pump", "bottle", "drink"]);

export function getStatisticsTabDataTypes(activityType: Readonly<ActivityType>): StatisticsTabDataType[] {
  const tabs: StatisticsTabDataType[] = ["numberOfTimes"];
  if (activityType.hasDuration) tabs.push("duration");
  if (activityType.uid === "temperature") tabs.push("temperature");
  if (VOLUME_TYPES.has(activityType.uid)) tabs.push("volume");
  if (activityType.hasAmount) tabs.push("amount");
  if (activityType.hasReaction) tabs.push("reaction");
  tabs.push("timeOfDay");
  return tabs;
}

export function buildStatisticsScreenData(
  activityTypes: readonly ActivityType[],
  activities: readonly DailyAction[],
  configuredTypeUids: readonly string[] = [],
  preferredTypeUid?: string,
): StatisticsScreenData {
  const activeTypes = activityTypes.filter((activityType) => !activityType.deleted);
  const typeMap = new Map(activeTypes.map((activityType) => [activityType.uid, activityType]));
  const orderedTypes = configuredTypeUids.length
    ? [...new Set(configuredTypeUids)].flatMap((uid) => {
      const activityType = typeMap.get(uid);
      return activityType ? [activityType] : [];
    })
    : activeTypes;
  const countMap = new Map<string, number>();
  for (const activity of activities) {
    if (!activity.deleted && typeMap.has(activity.type)) countMap.set(activity.type, (countMap.get(activity.type) ?? 0) + 1);
  }
  const items = orderedTypes.map((activityType) => ({
    activityType,
    activityCount: countMap.get(activityType.uid) ?? 0,
    tabs: getStatisticsTabDataTypes(activityType),
  }));
  return {
    items,
    selectedItem: items.find((item) => item.activityType.uid === preferredTypeUid) ?? items[0],
  };
}
