import { describe, expect, it } from "vitest";
import { formatMomentMonthId, groupMomentsByMonth } from "../src/index.js";
import type { Moment } from "../src/index.js";

describe("native moment month lists", () => {
  it("sorts by descending date then uid and groups by local calendar month", () => {
    const moments = [
      moment("b", "2026-07-01T00:30:00.000Z"),
      moment("a", "2026-07-01T00:30:00.000Z"),
      moment("old", "2026-06-01T12:00:00.000Z"),
      { ...moment("deleted", "2026-07-02T00:00:00.000Z"), deleted: true },
    ];

    expect(groupMomentsByMonth(moments, { timeZone: "UTC" })).toEqual([
      expect.objectContaining({ monthId: "202607", moments: [expect.objectContaining({ uid: "a" }), expect.objectContaining({ uid: "b" })] }),
      expect.objectContaining({ monthId: "202606", moments: [expect.objectContaining({ uid: "old" })] }),
    ]);
    expect(groupMomentsByMonth(moments, { timeZone: "UTC", includeDeleted: true })[0]?.moments[0]).toMatchObject({ uid: "deleted" });
  });

  it("uses the requested timezone at month boundaries and expands filters to full months", () => {
    const boundary = Date.parse("2026-07-01T00:30:00.000Z");
    expect(formatMomentMonthId(boundary, "UTC")).toBe("202607");
    expect(formatMomentMonthId(boundary, "America/Chicago")).toBe("202606");

    const moments = [moment("june", "2026-06-15T12:00:00.000Z"), moment("july", "2026-07-31T23:00:00.000Z")];
    expect(groupMomentsByMonth(moments, {
      fromMillis: Date.parse("2026-07-15T00:00:00.000Z"),
      toMillis: Date.parse("2026-07-15T00:00:00.000Z"),
      timeZone: "UTC",
    })[0]?.moments.map(({ uid }) => uid)).toEqual(["july"]);
  });
});

function moment(uid: string, date: string): Moment {
  return { uid, userUid: "user", babyUid: "baby", dateMillis: Date.parse(date) };
}
