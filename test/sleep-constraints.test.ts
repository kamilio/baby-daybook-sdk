import { describe, expect, it } from "vitest";
import { clampSleepDurationToLooseConstraint, loosenSleepDurationConstraint } from "../src/index.js";

describe("native sleep duration constraint loosening", () => {
  it("loosens each edge by ten percent rounded to five minutes", () => {
    expect(loosenSleepDurationConstraint({ minimumMinutes: 60, maximumMinutes: 120 })).toEqual({
      minimumMinutes: 55,
      maximumMinutes: 130,
    });
    expect(loosenSleepDurationConstraint({ minimumMinutes: 125, maximumMinutes: 185 })).toEqual({
      minimumMinutes: 110,
      maximumMinutes: 205,
    });
  });

  it("caps each adjustment at thirty minutes", () => {
    expect(loosenSleepDurationConstraint({ minimumMinutes: 400, maximumMinutes: 600 })).toEqual({
      minimumMinutes: 370,
      maximumMinutes: 630,
    });
  });

  it("clamps values to the loosened constraint", () => {
    const constraint = { minimumMinutes: 60, maximumMinutes: 120 };
    expect(clampSleepDurationToLooseConstraint(30, constraint)).toBe(55);
    expect(clampSleepDurationToLooseConstraint(90, constraint)).toBe(90);
    expect(clampSleepDurationToLooseConstraint(180, constraint)).toBe(130);
  });

  it("rejects malformed constraints and durations", () => {
    expect(() => loosenSleepDurationConstraint({ minimumMinutes: -1, maximumMinutes: 10 })).toThrow("minimumMinutes");
    expect(() => loosenSleepDurationConstraint({ minimumMinutes: 10, maximumMinutes: 9 })).toThrow("maximumMinutes");
    expect(() => clampSleepDurationToLooseConstraint(Number.NaN, { minimumMinutes: 10, maximumMinutes: 20 })).toThrow("durationMinutes");
  });
});
