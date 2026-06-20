import { describe, expect, it } from "vitest";
import {
  BABY_DAYBOOK_UNIT_FACTORS,
  convertValueToImperial,
  convertValueToMetric,
  formatGrowthLength,
  formatGrowthWeight,
  formatTemperature,
  formatVolume,
  poundsToPoundsAndOunces,
} from "../src/units.js";

describe("Baby Daybook measurement units", () => {
  it("matches the native conversion constants", () => {
    expect(convertValueToImperial(120, "volume")).toBeCloseTo(120 * BABY_DAYBOOK_UNIT_FACTORS.millilitersToFluidOunces, 12);
    expect(convertValueToImperial(37, "temperature")).toBeCloseTo(98.6, 12);
    expect(convertValueToImperial(3.5, "weight")).toBeCloseTo(7.71617917, 10);
    expect(convertValueToImperial(50, "height")).toBeCloseTo(19.68503935, 8);
    expect(convertValueToImperial(35, "headSize")).toBeCloseTo(13.779527545, 8);
  });

  it("round trips every native unit type", () => {
    for (const unitType of ["volume", "temperature", "weight", "height", "headSize"] as const) {
      expect(convertValueToMetric(convertValueToImperial(42.75, unitType), unitType)).toBeCloseTo(42.75, 10);
    }
  });

  it("splits decimal pounds with native ounce rounding and carry", () => {
    expect(poundsToPoundsAndOunces(7.7161791763)).toEqual({ pounds: 7, ounces: 11.5 });
    expect(poundsToPoundsAndOunces(4.997)).toEqual({ pounds: 5, ounces: 0 });
    expect(poundsToPoundsAndOunces(-2.5)).toEqual({ pounds: 2, ounces: 8 });
  });

  it("formats measurements with native precision and labels", () => {
    expect(formatTemperature(37, "celsius")).toBe("37 °C");
    expect(formatTemperature(37, "fahrenheit")).toBe("98.6 °F");
    expect(formatVolume(120, "milliliters")).toBe("120 ml");
    expect(formatVolume(120, "fluidOunces")).toBe("4.06 fl oz");
    expect(formatGrowthWeight(3.5, "kilograms")).toBe("3.5 kg");
    expect(formatGrowthWeight(3.5, "poundsAndOunces")).toBe("7 lb 11.5 oz");
    expect(formatGrowthLength(50, "centimeters")).toBe("50 cm");
    expect(formatGrowthLength(50, "inches")).toBe("19.7 in");
  });

  it("rejects values Firestore and the app cannot represent", () => {
    expect(() => convertValueToImperial(Number.NaN, "volume")).toThrow("must be finite");
    expect(() => formatTemperature(Number.POSITIVE_INFINITY, "celsius")).toThrow("must be finite");
  });
});
