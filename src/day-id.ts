export function formatBabyDaybookDayId(at: Date | number, timeZone = localTimeZone()): string {
  const millis = at instanceof Date ? at.getTime() : at;
  if (!Number.isFinite(millis)) throw new RangeError("Daily note date must be valid");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(millis);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
