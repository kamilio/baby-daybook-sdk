import type { ActivitySearchOptions, DailyAction, DailyNote } from "./types.js";

export function searchActivities(activities: readonly DailyAction[], options: ActivitySearchOptions = {}): DailyAction[] {
  const query = options.query?.trim().toLocaleLowerCase();
  const types = options.types && new Set(options.types);
  const groups = options.groupUids && new Set(options.groupUids);
  return activities
    .filter((activity) => options.includeDeleted || !activity.deleted)
    .filter((activity) => !types || types.has(activity.type))
    .filter((activity) => !groups || (activity.groupUid !== undefined && groups.has(activity.groupUid)))
    .filter((activity) => options.fromMillis === undefined || activity.startMillis >= options.fromMillis)
    .filter((activity) => options.toMillis === undefined || activity.startMillis <= options.toMillis)
    .filter((activity) => !query || searchableActivityText(activity).includes(query))
    .sort((left, right) => right.startMillis - left.startMillis);
}

export function searchDailyNotes(notes: readonly DailyNote[], query: string, options: { includeDeleted?: boolean } = {}): DailyNote[] {
  const normalized = query.trim().toLocaleLowerCase();
  return notes.filter((note) => (options.includeDeleted || !note.deleted) && (!normalized || note.note.toLocaleLowerCase().includes(normalized)));
}

function searchableActivityText(activity: DailyAction): string {
  return [activity.type, activity.notes, activity.amountUnit, activity.reaction, activity.side]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();
}
