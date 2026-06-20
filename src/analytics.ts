import type { ActivitySummary, DailyAction } from "./types.js";

export function summarizeActivities(activities: readonly DailyAction[]): ActivitySummary {
  const summary: ActivitySummary = { count: 0, totalDurationMillis: 0, totalVolume: 0, totalAmount: 0, byType: {} };
  for (const activity of activities) {
    if (activity.deleted) continue;
    const duration = activity.duration ?? Math.max(0, (activity.endMillis ?? activity.startMillis) - activity.startMillis);
    const type = summary.byType[activity.type] ?? { count: 0, durationMillis: 0, volume: 0, amount: 0 };
    type.count += 1;
    type.durationMillis += duration;
    type.volume += activity.volume ?? 0;
    type.amount += activity.amount ?? 0;
    summary.byType[activity.type] = type;
    summary.count += 1;
    summary.totalDurationMillis += duration;
    summary.totalVolume += activity.volume ?? 0;
    summary.totalAmount += activity.amount ?? 0;
  }
  return summary;
}

export function activitiesToCsv(activities: readonly DailyAction[]): string {
  const headers = ["uid", "type", "startMillis", "endMillis", "duration", "side", "volume", "amount", "amountUnit", "reaction", "pee", "poo", "hairWash", "notes"];
  const rows = activities.map((activity) => headers.map((header) => csvCell((activity as any)[header])).join(","));
  return [headers.join(","), ...rows].join("\n");
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
