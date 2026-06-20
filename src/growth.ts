import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GrowthMeasurement,
  GrowthPercentileInput,
  GrowthPercentileResult,
  GrowthRangeUnit,
  GrowthReferenceSource,
} from "./types.js";

interface LmsData {
  rangeKey: "Week" | "Month" | "Year";
  range: number[];
  L: number[];
  M: number[];
  S: number[];
}

const REFERENCE_PERCENTILES = [5, 10, 25, 50, 75, 90, 95] as const;
const Z_BY_PERCENTILE = [
  -2.326, -2.054, -1.881, -1.751, -1.645, -1.555, -1.476, -1.405, -1.341, -1.282,
  -1.227, -1.175, -1.126, -1.08, -1.036, -0.994, -0.954, -0.915, -0.878, -0.842,
  -0.806, -0.772, -0.739, -0.706, -0.674, -0.643, -0.613, -0.583, -0.553, -0.524,
  -0.496, -0.468, -0.44, -0.412, -0.385, -0.358, -0.332, -0.305, -0.279, -0.253,
  -0.228, -0.202, -0.176, -0.151, -0.126, -0.1, -0.075, -0.05, -0.025, 0,
  0.025, 0.05, 0.075, 0.1, 0.126, 0.151, 0.176, 0.202, 0.228, 0.253,
  0.279, 0.305, 0.332, 0.358, 0.385, 0.412, 0.44, 0.468, 0.496, 0.524,
  0.553, 0.583, 0.613, 0.643, 0.674, 0.706, 0.739, 0.772, 0.806, 0.842,
  0.878, 0.915, 0.954, 0.994, 1.036, 1.08, 1.126, 1.175, 1.227, 1.282,
  1.341, 1.405, 1.476, 1.555, 1.645, 1.751, 1.881, 2.054, 2.326,
] as const;
const SOURCE_PATHS: Record<GrowthReferenceSource, { directory: string; suffix: string }> = {
  cdc_0_36_months: { directory: "cdc", suffix: "0_36_months" },
  cdc_2_20_years: { directory: "cdc", suffix: "2_20_years" },
  cdcDS_0_36_months: { directory: "cdc_down_syndrome", suffix: "0_36_months" },
  cdcDS_2_20_years: { directory: "cdc_down_syndrome", suffix: "2_20_years" },
  who_0_13_weeks: { directory: "who", suffix: "0_13_weeks" },
  who_0_60_months: { directory: "who", suffix: "0_60_months" },
};
const cache = new Map<string, LmsData>();

export function calculateGrowthPercentile(input: GrowthPercentileInput): GrowthPercentileResult | undefined {
  if (!Number.isFinite(input.age) || !Number.isFinite(input.value) || input.value <= 0) return undefined;
  const data = loadLmsData(input.source, input.gender, input.measurement);
  if (!data) return undefined;
  const parameters = interpolateParameters(data, input.age);
  if (!parameters) return undefined;
  const zScore = calculateZScore(input.value, parameters.L, parameters.M, parameters.S);
  const referenceValues = Object.fromEntries(
    REFERENCE_PERCENTILES.map((percentile) => [percentile, calculateValue(parameters.L, parameters.M, parameters.S, Z_BY_PERCENTILE[percentile - 1]!)]),
  ) as GrowthPercentileResult["referenceValues"];
  return {
    percentile: nearestPercentile(zScore),
    zScore,
    rangeUnit: rangeUnit(data.rangeKey),
    referenceValues,
  };
}

export function calculateGrowthValueAtPercentile(
  input: Omit<GrowthPercentileInput, "value"> & { percentile: number },
): number | undefined {
  if (!Number.isInteger(input.percentile) || input.percentile < 1 || input.percentile > 99) return undefined;
  const data = loadLmsData(input.source, input.gender, input.measurement);
  const parameters = data && interpolateParameters(data, input.age);
  if (!parameters) return undefined;
  return calculateValue(parameters.L, parameters.M, parameters.S, Z_BY_PERCENTILE[input.percentile - 1]!);
}

export function growthAgeAtDate(birthday: Date | number, date: Date | number, unit: GrowthRangeUnit): number {
  const start = typeof birthday === "number" ? new Date(birthday) : birthday;
  const end = typeof date === "number" ? new Date(date) : date;
  const elapsedDays = (end.getTime() - start.getTime()) / 86_400_000;
  if (unit === "weeks") return elapsedDays / 7;
  if (unit === "years") return elapsedDays / 365.2425;
  return elapsedDays / 30.436875;
}

function loadLmsData(source: GrowthReferenceSource, gender: "male" | "female", measurement: GrowthMeasurement): LmsData | undefined {
  const sourcePath = SOURCE_PATHS[source];
  const prefix = gender === "male" ? "boys" : "girls";
  const measurementName = measurement === "headSize" ? "head_size" : measurement;
  const key = `${sourcePath.directory}/${prefix}_${measurementName}_${sourcePath.suffix}.json`;
  if (cache.has(key)) return cache.get(key);
  try {
    const moduleDirectory = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));
    const file = resolve(moduleDirectory, "..", "data", "percentiles", key);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, number[]>;
    const rangeKey = (["Week", "Month", "Year"] as const).find((candidate) => Array.isArray(parsed[candidate]));
    if (!rangeKey || !parsed.L || !parsed.M || !parsed.S) return undefined;
    const range = parsed[rangeKey];
    if (!range) return undefined;
    const data = { rangeKey, range, L: parsed.L, M: parsed.M, S: parsed.S };
    cache.set(key, data);
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function interpolateParameters(data: LmsData, age: number): { L: number; M: number; S: number } | undefined {
  const first = data.range[0];
  const last = data.range.at(-1);
  if (first === undefined || last === undefined || age < first || age > last) return undefined;
  const upper = data.range.findIndex((value) => value >= age);
  if (upper < 0) return undefined;
  if (upper === 0 || data.range[upper] === age) {
    return parametersAt(data, upper);
  }
  const lower = upper - 1;
  const lowerAge = data.range[lower]!;
  const upperAge = data.range[upper]!;
  const ratio = upperAge === lowerAge ? 0 : (age - lowerAge) / (upperAge - lowerAge);
  return {
    L: lerp(data.L[lower]!, data.L[upper]!, ratio),
    M: lerp(data.M[lower]!, data.M[upper]!, ratio),
    S: lerp(data.S[lower]!, data.S[upper]!, ratio),
  };
}

function parametersAt(data: LmsData, index: number): { L: number; M: number; S: number } | undefined {
  const L = data.L[index];
  const M = data.M[index];
  const S = data.S[index];
  return L === undefined || M === undefined || S === undefined ? undefined : { L, M, S };
}

function calculateZScore(value: number, L: number, M: number, S: number): number {
  return L === 0 ? Math.log(value / M) / S : (Math.pow(value / M, L) - 1) / (L * S);
}

function calculateValue(L: number, M: number, S: number, zScore: number): number {
  return L === 0 ? M * Math.exp(S * zScore) : M * Math.pow(1 + L * S * zScore, 1 / L);
}

function nearestPercentile(zScore: number): number {
  if (zScore < Z_BY_PERCENTILE[0]) return 0;
  if (zScore > Z_BY_PERCENTILE.at(-1)!) return 100;
  let nearest = 1;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < Z_BY_PERCENTILE.length; index += 1) {
    const nextDistance = Math.abs(zScore - Z_BY_PERCENTILE[index]!);
    if (nextDistance < distance) {
      nearest = index + 1;
      distance = nextDistance;
    }
  }
  return nearest;
}

function rangeUnit(key: LmsData["rangeKey"]): GrowthRangeUnit {
  return key === "Week" ? "weeks" : key === "Year" ? "years" : "months";
}

function lerp(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio;
}
