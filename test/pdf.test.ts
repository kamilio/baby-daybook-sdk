import { describe, expect, it } from "vitest";
import { activitiesToPdf, growthToPdf, timelineToPdf } from "../src/index.js";
import type { DailyAction, GrowthEntry } from "../src/index.js";

describe("PDF exports", () => {
  it("creates a valid deterministic single-page PDF", () => {
    const bytes = activitiesToPdf([
      activity({ uid: "a", type: "bottle", startMillis: Date.UTC(2026, 6, 6, 8), amount: 4, amountUnit: "oz", notes: "Milk (warm) \\ ready" }),
      activity({ uid: "b", type: "sleeping", startMillis: Date.UTC(2026, 6, 6, 9), endMillis: Date.UTC(2026, 6, 6, 10, 30) }),
      activity({ uid: "c", type: "other", startMillis: Date.UTC(2026, 6, 6, 11), deleted: true }),
    ], {
      babyName: "Ada",
      generatedAt: Date.UTC(2026, 6, 6, 12),
    });
    const pdf = new TextDecoder().decode(bytes);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/Type /Pages");
    expect(pdf).toContain("/Count 1");
    expect(pdf).toContain("Baby: Ada");
    expect(pdf).toContain("Activities: 2");
    expect(pdf).toContain("Milk \\(warm\\) \\\\ ready");
    expect(pdf.endsWith("%%EOF\n")).toBe(true);
    expectValidXref(pdf);
  });

  it("paginates large reports and includes deleted rows on request", () => {
    const rows = Array.from({ length: 100 }, (_, index) => activity({
      uid: String(index),
      type: "bottle",
      startMillis: Date.UTC(2026, 6, 6, 8) + index * 60_000,
      deleted: index === 0,
    }));
    const pdf = new TextDecoder().decode(activitiesToPdf(rows, {
      includeDeleted: true,
      generatedAt: 0,
      timeZone: "UTC",
      includeDayTimeline: false,
      includeDaySummaries: false,
    }));
    expect(pdf).toContain("/Count 3");
    expect(pdf).toContain("Activities: 100");
    expect(pdf).toContain("Page 3 of 3");
    expectValidXref(pdf);
  });

  it("filters report rows by timestamp", () => {
    const pdf = new TextDecoder().decode(activitiesToPdf([
      activity({ uid: "a", type: "before", startMillis: 100 }),
      activity({ uid: "b", type: "inside", startMillis: 200 }),
      activity({ uid: "c", type: "after", startMillis: 300 }),
    ], { fromMillis: 150, toMillis: 250, generatedAt: 0 }));
    expect(pdf).toContain("inside");
    expect(pdf).not.toContain("before");
    expect(pdf).not.toContain("after");
  });

  it("composes daily-list sections in the app order and matches yyyyMMdd notes", () => {
    const pdf = new TextDecoder().decode(activitiesToPdf([
      activity({ uid: "a", type: "sleep", startMillis: Date.UTC(2026, 0, 2, 8), duration: 2 * 3_600_000 }),
    ], {
      generatedAt: 0,
      timeZone: "UTC",
      babyBirthdayMillis: Date.UTC(2026, 0, 1),
      activityTypes: [{ uid: "sleep", userUid: "u", babyUid: "b", title: "Sleep" }],
      dailyNotes: [
        { uid: "20260102", userUid: "u", babyUid: "b", note: "Great day" },
        { uid: "not-a-date", userUid: "u", babyUid: "b", note: "Ignored" },
      ],
    }));
    const labelIndex = pdf.indexOf("2026-01-02 - age 1 day");
    const timelineIndex = pdf.indexOf("Timeline");
    const noteIndex = pdf.indexOf("Day note: Great day");
    const summaryIndex = pdf.indexOf("Day summary: 1 activity");
    const itemIndex = pdf.indexOf("Date and time");
    expect(labelIndex).toBeGreaterThan(-1);
    expect(labelIndex).toBeLessThan(timelineIndex);
    expect(timelineIndex).toBeLessThan(noteIndex);
    expect(noteIndex).toBeLessThan(summaryIndex);
    expect(summaryIndex).toBeLessThan(itemIndex);
    expect(pdf).toContain("Sleep: 1, 2h 0m");
    expect(pdf).not.toContain("Ignored");
  });

  it("includes note-only days and respects daily-list section switches", () => {
    const pdf = new TextDecoder().decode(activitiesToPdf([], {
      generatedAt: 0,
      timeZone: "UTC",
      dailyNotes: [{ uid: "20260103", userUid: "u", babyUid: "b", note: "Note only" }],
      includeDayTimeline: false,
      includeDaySummaries: false,
      includeActivities: false,
    }));
    expect(pdf).toContain("2026-01-03");
    expect(pdf).toContain("Day note: Note only");
    expect(pdf).not.toContain("Timeline");
    expect(pdf).not.toContain("Day summary");
    expect(pdf).not.toContain("Date and time");
  });

  it("renders display titles for native blank activity types in every activity report section", () => {
    const activityTypes = [{ uid: "bottle", userUid: "u", babyUid: "b", title: "" }];
    const activities = [activity({ uid: "a", type: "bottle", startMillis: Date.UTC(2026, 0, 2, 8) })];
    const activityPdf = new TextDecoder().decode(activitiesToPdf(activities, {
      activityTypes,
      generatedAt: 0,
      timeZone: "UTC",
    }));
    const timelinePdf = new TextDecoder().decode(timelineToPdf(activities, {
      activityTypes,
      generatedAt: 0,
      timeZone: "UTC",
    }));

    expect(activityPdf).toContain("Bottle: 1");
    expect(activityPdf.match(/Bottle/g)).toHaveLength(3);
    expect(activityPdf).not.toContain("  : 1");
    expect(timelinePdf).toContain("Bottle");
  });

  it("exports growth rows and app-equivalent chart categories", () => {
    const pdf = new TextDecoder().decode(growthToPdf([
      growth({ uid: "a", dateMillis: Date.UTC(2026, 0, 1), weight: 5, height: 60, headSize: 40, notes: "First" }),
      growth({ uid: "b", dateMillis: Date.UTC(2026, 1, 1), weight: 6, height: 62, headSize: 41 }),
      growth({ uid: "deleted", dateMillis: Date.UTC(2026, 2, 1), weight: 7, deleted: true }),
    ], {
      babyName: "Ada",
      generatedAt: 0,
      weightUnit: "lb",
      lengthUnit: "in",
    }));
    expect(pdf).toContain("Baby Daybook growth report");
    expect(pdf).toContain("Measurements: 2");
    expect(pdf).toContain("11.02");
    expect(pdf).toContain("23.62");
    expect(pdf).toContain("Weight chart: 2 points");
    expect(pdf).toContain("Height chart: 2 points");
    expect(pdf).toContain("Head-size chart: 2 points");
    expectValidXref(pdf);
  });

  it("supports selecting growth chart categories", () => {
    const pdf = new TextDecoder().decode(growthToPdf([], {
      generatedAt: 0,
      includeWeightChart: false,
      includeHeightChart: true,
      includeHeadSizeChart: false,
    }));
    expect(pdf).not.toContain("Weight chart");
    expect(pdf).toContain("Height chart: no data");
    expect(pdf).not.toContain("Head-size chart");
  });

  it("exports a day-grouped activity timeline with configurable hour labels", () => {
    const pdf = new TextDecoder().decode(timelineToPdf([
      activity({ uid: "a", type: "sleeping", startMillis: Date.UTC(2026, 0, 1, 20), endMillis: Date.UTC(2026, 0, 1, 22) }),
      activity({ uid: "b", type: "bottle", startMillis: Date.UTC(2026, 0, 2, 1), duration: 15 * 60_000, notes: "Night feed" }),
    ], { generatedAt: 0, hourLabelInterval: 6, timeZone: "UTC" }));
    expect(pdf).toContain("Baby Daybook timeline report");
    expect(pdf).toContain("Hour labels: every 6 hours");
    expect(pdf).toContain("Hours: 00:00 06:00 12:00 18:00");
    expect(pdf).toContain("2026-01-01");
    expect(pdf).toContain("2026-01-02");
    expect(pdf).toContain("Night feed");
    expectValidXref(pdf);
  });
});

function expectValidXref(pdf: string): void {
  const startXref = Number(pdf.match(/startxref\n(\d+)\n/)?.[1]);
  expect(pdf.slice(startXref, startXref + 4)).toBe("xref");
  const entries = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)];
  entries.forEach((entry, index) => {
    const offset = Number(entry[1]);
    expect(pdf.slice(offset, offset + String(index + 1).length + 6)).toBe(`${index + 1} 0 obj`);
  });
}

function activity(update: Partial<DailyAction>): DailyAction {
  return { uid: "id", userUid: "u", babyUid: "b", type: "other", startMillis: 0, ...update };
}

function growth(update: Partial<GrowthEntry>): GrowthEntry {
  return { uid: "id", userUid: "u", babyUid: "b", dateMillis: 0, ...update };
}
