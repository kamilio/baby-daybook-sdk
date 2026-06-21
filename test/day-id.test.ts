import { describe, expect, it } from "vitest";
import { formatBabyDaybookDayId } from "../src/day-id.js";

describe("Baby Daybook day IDs", () => {
  it("formats yyyyMMdd in the selected timezone", () => {
    const at = Date.parse("2026-01-02T00:30:00.000Z");
    expect(formatBabyDaybookDayId(at, "America/Los_Angeles")).toBe("20260101");
    expect(formatBabyDaybookDayId(at, "Asia/Tokyo")).toBe("20260102");
    expect(formatBabyDaybookDayId(new Date(at))).toBe(formatBabyDaybookDayId(at, Intl.DateTimeFormat().resolvedOptions().timeZone));
  });

  it("rejects invalid dates and timezones", () => {
    expect(() => formatBabyDaybookDayId(Number.NaN, "UTC")).toThrow("Daily note date must be valid");
    expect(() => formatBabyDaybookDayId(0, "Not/A_Timezone")).toThrow(RangeError);
  });
});
