export type UnitType = "volume" | "temperature" | "weight" | "height" | "headSize";
export type TemperatureUnit = "celsius" | "fahrenheit";
export type VolumeUnit = "milliliters" | "fluidOunces";
export type GrowthWeightUnit = "kilograms" | "poundsAndOunces";
export type GrowthLengthUnit = "centimeters" | "inches";

export interface PoundsAndOunces {
  pounds: number;
  ounces: number;
}

export const BABY_DAYBOOK_UNIT_FACTORS = Object.freeze({
  millilitersToFluidOunces: 0.0338140227,
  kilogramsToPounds: 2.20462262,
  centimetersToInches: 0.393700787,
  celsiusToFahrenheitScale: 1.8,
} as const);

export function convertValueToImperial(value: number, unitType: UnitType): number {
  assertFinite(value);
  switch (unitType) {
    case "volume":
      return value * BABY_DAYBOOK_UNIT_FACTORS.millilitersToFluidOunces;
    case "temperature":
      return value * BABY_DAYBOOK_UNIT_FACTORS.celsiusToFahrenheitScale + 32;
    case "weight":
      return value * BABY_DAYBOOK_UNIT_FACTORS.kilogramsToPounds;
    case "height":
    case "headSize":
      return value * BABY_DAYBOOK_UNIT_FACTORS.centimetersToInches;
  }
}

export function convertValueToMetric(value: number, unitType: UnitType): number {
  assertFinite(value);
  switch (unitType) {
    case "volume":
      return value / BABY_DAYBOOK_UNIT_FACTORS.millilitersToFluidOunces;
    case "temperature":
      return (value - 32) * 5 / 9;
    case "weight":
      return value / BABY_DAYBOOK_UNIT_FACTORS.kilogramsToPounds;
    case "height":
    case "headSize":
      return value / BABY_DAYBOOK_UNIT_FACTORS.centimetersToInches;
  }
}

export function getConvertedTemperature(celsius: number, unit: TemperatureUnit): number {
  return unit === "fahrenheit" ? convertValueToImperial(celsius, "temperature") : finite(celsius);
}

export function getConvertedVolume(milliliters: number, unit: VolumeUnit): number {
  return unit === "fluidOunces" ? convertValueToImperial(milliliters, "volume") : finite(milliliters);
}

export function getConvertedGrowthWeight(kilograms: number, unit: GrowthWeightUnit): number {
  return unit === "poundsAndOunces" ? convertValueToImperial(kilograms, "weight") : finite(kilograms);
}

export function getConvertedGrowthLength(centimeters: number, unit: GrowthLengthUnit): number {
  return unit === "inches" ? convertValueToImperial(centimeters, "height") : finite(centimeters);
}

export function poundsToPoundsAndOunces(poundsValue: number): PoundsAndOunces {
  const absolute = Math.abs(finite(poundsValue));
  let pounds = Math.floor(absolute);
  let ounces = Number(((absolute - pounds) * 16).toFixed(1));
  if (ounces === 16) {
    pounds += 1;
    ounces = 0;
  }
  return { pounds, ounces };
}

export function formatTemperature(celsius: number, unit: TemperatureUnit): string {
  const value = getConvertedTemperature(celsius, unit);
  return `${formatNumber(value, 1)} ${unit === "fahrenheit" ? "°F" : "°C"}`;
}

export function formatVolume(milliliters: number, unit: VolumeUnit): string {
  const value = getConvertedVolume(milliliters, unit);
  return `${formatNumber(value, 2)} ${unit === "fluidOunces" ? "fl oz" : "ml"}`;
}

export function formatGrowthWeight(kilograms: number, unit: GrowthWeightUnit): string {
  if (unit === "kilograms") return `${formatNumber(kilograms, 3)} kg`;
  const value = getConvertedGrowthWeight(kilograms, unit);
  const { pounds, ounces } = poundsToPoundsAndOunces(value);
  const sign = value < 0 ? "-" : "";
  return ounces > 0
    ? `${sign}${formatNumber(pounds, 0)} lb ${formatNumber(ounces, 1)} oz`
    : `${sign}${formatNumber(pounds, 0)} lb`;
}

export function formatGrowthLength(centimeters: number, unit: GrowthLengthUnit): string {
  const value = getConvertedGrowthLength(centimeters, unit);
  return `${formatNumber(value, 1)} ${unit === "inches" ? "in" : "cm"}`;
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(finite(value));
}

function finite(value: number): number {
  assertFinite(value);
  return value;
}

function assertFinite(value: number): void {
  if (!Number.isFinite(value)) throw new RangeError("Unit value must be finite");
}
