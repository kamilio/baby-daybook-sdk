import type { FileMetadata, GrowthEntry, GrowthMeasurement, Moment } from "./types.js";
import {
  formatGrowthLength,
  formatGrowthWeight,
  type GrowthLengthUnit,
  type GrowthWeightUnit,
} from "./units.js";

export interface DevelopmentGrowthOptions {
  weightUnit?: GrowthWeightUnit;
  lengthUnit?: GrowthLengthUnit;
}

export interface DevelopmentGrowthItem {
  measurement: GrowthMeasurement;
  value: number;
  formatted: string;
}

export interface DevelopmentGrowthSummary {
  count: number;
  growth?: GrowthEntry;
  items: DevelopmentGrowthItem[];
}

export interface DevelopmentMomentsSummary {
  count: number;
  files: FileMetadata[];
}

const GROWTH_MEASUREMENTS = ["weight", "height", "headSize"] as const;

export function getLastGrowthWithValues(entries: readonly GrowthEntry[]): GrowthEntry | undefined {
  const sorted = entries
    .filter((entry) => !entry.deleted)
    .sort((left, right) => right.dateMillis - left.dateMillis);
  const latest = sorted[0];
  if (!latest) return undefined;
  const merged = { ...latest };
  for (const older of sorted.slice(1)) {
    for (const measurement of GROWTH_MEASUREMENTS) {
      if (!hasGrowthValue(merged[measurement]) && hasGrowthValue(older[measurement])) merged[measurement] = older[measurement];
    }
    if (GROWTH_MEASUREMENTS.every((measurement) => hasGrowthValue(merged[measurement]))) break;
  }
  return merged;
}

export function buildDevelopmentGrowthSummary(
  entries: readonly GrowthEntry[],
  options: DevelopmentGrowthOptions = {},
): DevelopmentGrowthSummary {
  const active = entries.filter((entry) => !entry.deleted);
  const growth = getLastGrowthWithValues(active);
  if (!growth) return { count: active.length, items: [] };
  const weightUnit = options.weightUnit ?? "kilograms";
  const lengthUnit = options.lengthUnit ?? "centimeters";
  const items = GROWTH_MEASUREMENTS.map((measurement): DevelopmentGrowthItem => {
    const value = growth[measurement] ?? 0;
    return {
      measurement,
      value,
      formatted: measurement === "weight"
        ? formatGrowthWeight(value, weightUnit)
        : formatGrowthLength(value, lengthUnit),
    };
  });
  return { count: active.length, growth, items };
}

export function buildDevelopmentMomentsSummary(
  moments: readonly Moment[],
  files: readonly FileMetadata[],
  limitCount: number,
): DevelopmentMomentsSummary {
  if (!Number.isSafeInteger(limitCount) || limitCount < 0) throw new RangeError("Development moment limit must be a non-negative safe integer");
  const activeMoments = moments
    .filter((moment) => !moment.deleted)
    .sort((left, right) => right.dateMillis - left.dateMillis || left.uid.localeCompare(right.uid));
  const activeFiles = new Map(files.filter((file) => !file.deleted).map((file) => [file.itemUid, file]));
  return {
    count: activeMoments.length,
    files: activeMoments.slice(0, limitCount).flatMap((moment) => {
      const file = activeFiles.get(moment.uid);
      return file ? [file] : [];
    }),
  };
}

function hasGrowthValue(value: number | undefined): value is number {
  return value !== undefined && value > 0;
}
