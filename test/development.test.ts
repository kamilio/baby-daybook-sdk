import { describe, expect, it } from "vitest";
import {
  buildDevelopmentGrowthSummary,
  buildDevelopmentMomentsSummary,
  getLastGrowthWithValues,
} from "../src/index.js";
import type { FileMetadata, GrowthEntry, Moment } from "../src/index.js";

describe("native development summaries", () => {
  it("backfills missing values into the newest growth record", () => {
    const entries: GrowthEntry[] = [
      growth({ uid: "height", dateMillis: 100, height: 60 }),
      growth({ uid: "weight", dateMillis: 200, weight: 5 }),
      growth({ uid: "latest", dateMillis: 300, weight: 0, headSize: 40, notes: "Newest" }),
      growth({ uid: "deleted", dateMillis: 400, weight: 99, deleted: true }),
    ];

    expect(getLastGrowthWithValues(entries)).toMatchObject({
      uid: "latest",
      dateMillis: 300,
      notes: "Newest",
      weight: 5,
      height: 60,
      headSize: 40,
    });
  });

  it("formats all three native growth card items and counts active rows", () => {
    const summary = buildDevelopmentGrowthSummary([
      growth({ uid: "older", dateMillis: 100, weight: 4.5359237, height: 50.8 }),
      growth({ uid: "latest", dateMillis: 200, headSize: 0 }),
      growth({ uid: "deleted", dateMillis: 300, weight: 99, deleted: true }),
    ], { weightUnit: "poundsAndOunces", lengthUnit: "inches" });

    expect(summary.count).toBe(2);
    expect(summary.growth).toMatchObject({ uid: "latest", weight: 4.5359237, height: 50.8 });
    expect(summary.items).toEqual([
      { measurement: "weight", value: 4.5359237, formatted: "10 lb" },
      { measurement: "height", value: 50.8, formatted: "20 in" },
      { measurement: "headSize", value: 0, formatted: "0 in" },
    ]);
    expect(buildDevelopmentGrowthSummary([])).toEqual({ count: 0, items: [] });
  });

  it("limits newest moments before selecting their active preview files", () => {
    const moments: Moment[] = [
      moment({ uid: "older", dateMillis: 100 }),
      moment({ uid: "same-b", dateMillis: 300 }),
      moment({ uid: "same-a", dateMillis: 300 }),
      moment({ uid: "deleted", dateMillis: 400, deleted: true }),
    ];
    const files: FileMetadata[] = [
      file({ itemUid: "same-b", fileName: "b.jpg" }),
      file({ itemUid: "same-a", fileName: "a.jpg", deleted: true }),
      file({ itemUid: "older", fileName: "old.jpg" }),
    ];

    expect(buildDevelopmentMomentsSummary(moments, files, 2)).toEqual({
      count: 3,
      files: [expect.objectContaining({ itemUid: "same-b", fileName: "b.jpg" })],
    });
    expect(() => buildDevelopmentMomentsSummary(moments, files, -1)).toThrow("non-negative safe integer");
  });
});

function growth(update: Partial<GrowthEntry>): GrowthEntry {
  return { uid: "growth", userUid: "user", babyUid: "baby", dateMillis: 0, ...update };
}

function moment(update: Partial<Moment>): Moment {
  return { uid: "moment", userUid: "user", babyUid: "baby", dateMillis: 0, ...update };
}

function file(update: Partial<FileMetadata>): FileMetadata {
  return { itemUid: "moment", babyUid: "baby", fileName: "photo.jpg", ...update };
}
