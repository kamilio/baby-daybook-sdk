import type { Moment, MomentMonth, MomentMonthListOptions } from "./types.js";

export function formatMomentMonthId(at: Date | number, timeZone = localTimeZone()): string {
  const millis = at instanceof Date ? at.getTime() : at;
  if (!Number.isFinite(millis)) throw new RangeError("Moment date must be valid");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(millis);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}`;
}

export function groupMomentsByMonth(moments: readonly Moment[], options: MomentMonthListOptions = {}): MomentMonth[] {
  const timeZone = options.timeZone ?? localTimeZone();
  const fromMonth = options.fromMillis === undefined ? undefined : formatMomentMonthId(options.fromMillis, timeZone);
  const toMonth = options.toMillis === undefined ? undefined : formatMomentMonthId(options.toMillis, timeZone);
  const sorted = moments
    .filter((moment) => (options.includeDeleted || !moment.deleted))
    .sort((left, right) => right.dateMillis - left.dateMillis || left.uid.localeCompare(right.uid));
  const months = new Map<string, MomentMonth>();
  for (const moment of sorted) {
    const monthId = formatMomentMonthId(moment.dateMillis, timeZone);
    if (fromMonth !== undefined && monthId < fromMonth) continue;
    if (toMonth !== undefined && monthId > toMonth) continue;
    const existing = months.get(monthId);
    if (existing) existing.moments.push(moment);
    else months.set(monthId, { monthId, dateMillis: moment.dateMillis, moments: [moment] });
  }
  return [...months.values()];
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
