import { isNativeTrue } from "./native-flags.js";
import type { ActivitySearchOptions, DailyAction, DailyNote, DailyNoteSearchOptions } from "./types.js";

export function searchActivities(activities: readonly DailyAction[], options: ActivitySearchOptions = {}): DailyAction[] {
  const query = options.query?.trim().toLocaleLowerCase();
  const types = setOrUndefined(options.types);
  const groups = setOrUndefined(options.groupUids);
  const reactions = setOrUndefined(options.reactions);
  const parameters = setOrUndefined(options.parameters);
  const groupEntries = options.groupsByType && Object.entries(options.groupsByType).filter(([, values]) => values.length > 0);
  const groupsByType = groupEntries?.length ? new Map(groupEntries.map(([type, values]) => [type, new Set(values)])) : undefined;
  const matches = activities
    .filter((activity) => options.includeDeleted || !activity.deleted)
    .filter((activity) => !types || types.has(activity.type))
    .filter((activity) => !groups || (activity.groupUid !== undefined && groups.has(activity.groupUid)))
    .filter((activity) => !groupsByType || matchesGroupMap(activity, groupsByType))
    .filter((activity) => options.fromMillis === undefined || activity.startMillis >= options.fromMillis)
    .filter((activity) => options.toMillis === undefined || activity.startMillis <= options.toMillis)
    .filter((activity) => !query || activity.notes?.toLocaleLowerCase().includes(query))
    .filter((activity) => !reactions || (activity.reaction !== undefined && reactions.has(activity.reaction)))
    .filter((activity) => !parameters || [...parameters].every((parameter) => isNativeTrue(activity[parameter])))
    .sort((left, right) => right.startMillis - left.startMillis || left.type.localeCompare(right.type) || left.uid.localeCompare(right.uid));
  return paginate(matches, options.offset, options.limit);
}

export function countSearchActivities(activities: readonly DailyAction[], options: ActivitySearchOptions = {}): number {
  return searchActivities(activities, { ...options, offset: undefined, limit: undefined }).length;
}

export function searchDailyNotes(notes: readonly DailyNote[], query: string, options: DailyNoteSearchOptions = {}): DailyNote[] {
  const normalized = query.trim().toLocaleLowerCase();
  const matches = notes
    .filter((note) => options.includeDeleted || !note.deleted)
    .filter((note) => options.fromMillis === undefined || dailyNoteMillis(note.uid) >= options.fromMillis)
    .filter((note) => options.toMillis === undefined || dailyNoteMillis(note.uid) <= options.toMillis)
    .filter((note) => !normalized || note.note.toLocaleLowerCase().includes(normalized))
    .sort((left, right) => right.uid.localeCompare(left.uid));
  return paginate(matches, options.offset, options.limit);
}

export function countSearchDailyNotes(notes: readonly DailyNote[], query: string, options: DailyNoteSearchOptions = {}): number {
  return searchDailyNotes(notes, query, { ...options, offset: undefined, limit: undefined }).length;
}

function matchesGroupMap(activity: DailyAction, groupsByType: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const groups = groupsByType.get(activity.type);
  return groups !== undefined && activity.groupUid !== undefined && groups.has(activity.groupUid);
}

function dailyNoteMillis(uid: string): number {
  if (!/^\d{8}$/.test(uid)) return Number.NaN;
  return Date.UTC(Number(uid.slice(0, 4)), Number(uid.slice(4, 6)) - 1, Number(uid.slice(6, 8)));
}

function setOrUndefined<T>(values: readonly T[] | undefined): Set<T> | undefined {
  return values?.length ? new Set(values) : undefined;
}

function paginate<T>(items: T[], offset = 0, limit?: number): T[] {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("Search offset must be a non-negative integer");
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError("Search limit must be a non-negative integer");
  return items.slice(offset, limit === undefined ? undefined : offset + limit);
}
