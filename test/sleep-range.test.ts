import { describe, expect, it } from "vitest";
import { calculateAverageSleepRange } from "../src/index.js";

describe("calculateAverageSleepRange", () => {
  const referenceRange = { start: { hour: 7, minute: 0 }, end: { hour: 20, minute: 0 } };

  it("averages ordinary same-day sleep clock times", () => {
    expect(calculateAverageSleepRange(referenceRange, [
      range("2026-01-01T12:00:00Z", "2026-01-01T14:00:00Z"),
      range("2026-01-02T14:00:00Z", "2026-01-02T16:00:00Z"),
    ], "UTC")).toEqual({ start: { hour: 13, minute: 0 }, end: { hour: 15, minute: 0 } });
  });

  it("keeps crossing-midnight sleeps on one continuous clock", () => {
    expect(calculateAverageSleepRange(referenceRange, [
      range("2026-01-01T22:00:00Z", "2026-01-02T06:00:00Z"),
      range("2026-01-03T23:00:00Z", "2026-01-04T07:00:00Z"),
    ], "UTC")).toEqual({ start: { hour: 22, minute: 30 }, end: { hour: 6, minute: 30 } });
  });

  it("moves early same-day ranges after midnight when another sleep crosses midnight", () => {
    expect(calculateAverageSleepRange(referenceRange, [
      range("2026-01-01T22:00:00Z", "2026-01-02T06:00:00Z"),
      range("2026-01-03T05:00:00Z", "2026-01-03T07:00:00Z"),
    ], "UTC")).toEqual({ start: { hour: 1, minute: 30 }, end: { hour: 6, minute: 30 } });
  });

  it("uses calendar days and clock times from the requested timezone", () => {
    expect(calculateAverageSleepRange(referenceRange, [
      range("2026-01-02T03:00:00Z", "2026-01-02T11:00:00Z"),
    ], "America/Chicago")).toEqual({ start: { hour: 21, minute: 0 }, end: { hour: 5, minute: 0 } });
  });

  it("rejects empty, malformed, and reversed samples", () => {
    expect(() => calculateAverageSleepRange(referenceRange, [], "UTC")).toThrow("Sleep list must not be empty");
    expect(() => calculateAverageSleepRange(referenceRange, [{ startMillis: Number.NaN, endMillis: 1 }], "UTC")).toThrow("timestamps must be valid");
    expect(() => calculateAverageSleepRange(referenceRange, [{ startMillis: 2, endMillis: 1 }], "UTC")).toThrow("must not precede");
    expect(() => calculateAverageSleepRange({ start: { hour: 24, minute: 0 }, end: { hour: 20, minute: 0 } }, [range("2026-01-01T12:00:00Z", "2026-01-01T14:00:00Z")], "UTC")).toThrow("reference start");
  });
});

function range(start: string, end: string) {
  return { startMillis: Date.parse(start), endMillis: Date.parse(end) };
}
