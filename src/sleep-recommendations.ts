import { getSleepSchedulesForAge } from "./sleep-prediction.js";
import type {
  GroupedSleepRecommendation,
  SampleSleepSchedule,
  SleepDurationConstraint,
  SleepRecommendation,
} from "./types.js";

const NEWBORN_NAP_COUNT = { minimum: 5, maximum: 8 } as const;
const NEWBORN_SHARED_CONSTRAINTS = {
  nap: { minimumMinutes: 20, maximumMinutes: 120 },
  totalNap: { minimumMinutes: 240, maximumMinutes: 300 },
  nightSleep: { minimumMinutes: 600, maximumMinutes: 750 },
  totalSleep: { minimumMinutes: 840, maximumMinutes: 1020 },
} as const;

export function getSleepRecommendation(ageMonths: number): SleepRecommendation {
  const age = normalizeRecommendationAge(ageMonths);
  if (age < 2) {
    return {
      ageMonths: age,
      ...NEWBORN_SHARED_CONSTRAINTS,
      napCount: NEWBORN_NAP_COUNT,
      wakeWindow: age === 0
        ? { minimumMinutes: 35, maximumMinutes: 60 }
        : { minimumMinutes: 50, maximumMinutes: 80 },
    };
  }

  const schedules = getSleepSchedulesForAge(age);
  return {
    ageMonths: age,
    totalSleep: aggregateDuration(schedules, (schedule) => schedule.constraints.totalSleep),
    nightSleep: aggregateDuration(schedules, (schedule) => schedule.constraints.nightSleep),
    napCount: {
      minimum: Math.min(...schedules.map((schedule) => schedule.napCount)),
      maximum: Math.max(...schedules.map((schedule) => schedule.napCount)),
    },
    nap: aggregateDuration(schedules, (schedule) => schedule.constraints.nap),
    totalNap: aggregateDuration(schedules, (schedule) => schedule.constraints.totalNap),
    wakeWindow: aggregateDuration(schedules, (schedule) => schedule.constraints.wakeWindow),
  };
}

export function listSleepRecommendations(fromAgeMonths = 0, toAgeMonths = 59): SleepRecommendation[] {
  const from = normalizeRecommendationAge(fromAgeMonths);
  const to = normalizeRecommendationAge(toAgeMonths);
  if (from > to) throw new RangeError("fromAgeMonths must not exceed toAgeMonths");
  return Array.from({ length: to - from + 1 }, (_, index) => getSleepRecommendation(from + index));
}

export function groupSleepRecommendations(
  recommendations: readonly SleepRecommendation[],
): GroupedSleepRecommendation[] {
  const sorted = [...recommendations].sort((left, right) => left.ageMonths - right.ageMonths);
  const groups: GroupedSleepRecommendation[] = [];
  for (const recommendation of sorted) {
    const value = withoutAge(recommendation);
    const previous = groups.at(-1);
    const previousAge = previous?.agesMonths.at(-1);
    if (previous && previousAge !== undefined && recommendation.ageMonths === previousAge + 1
      && recommendationsEqual(previous.recommendation, value)) {
      groups[groups.length - 1] = {
        agesMonths: [...previous.agesMonths, recommendation.ageMonths],
        recommendation: previous.recommendation,
      };
    } else {
      groups.push({ agesMonths: [recommendation.ageMonths], recommendation: value });
    }
  }
  return groups;
}

export function listGroupedSleepRecommendations(
  fromAgeMonths = 0,
  toAgeMonths = 59,
): GroupedSleepRecommendation[] {
  return groupSleepRecommendations(listSleepRecommendations(fromAgeMonths, toAgeMonths));
}

function aggregateDuration(
  schedules: readonly SampleSleepSchedule[],
  select: (schedule: SampleSleepSchedule) => SleepDurationConstraint,
): SleepDurationConstraint {
  const constraints = schedules.map(select)
    .filter((constraint) => constraint.minimumMinutes !== 0 && constraint.maximumMinutes !== 0);
  if (constraints.length === 0) return { minimumMinutes: 0, maximumMinutes: 0 };
  return {
    minimumMinutes: Math.min(...constraints.map((constraint) => constraint.minimumMinutes)),
    maximumMinutes: Math.max(...constraints.map((constraint) => constraint.maximumMinutes)),
  };
}

function normalizeRecommendationAge(ageMonths: number): number {
  if (!Number.isFinite(ageMonths)) throw new RangeError("ageMonths must be finite");
  const age = Math.floor(ageMonths);
  if (age < 0 || age > 59) throw new RangeError("Sleep recommendations support ages 0 through 59 months");
  return age;
}

function withoutAge(recommendation: SleepRecommendation): Omit<SleepRecommendation, "ageMonths"> {
  return {
    totalSleep: recommendation.totalSleep,
    nightSleep: recommendation.nightSleep,
    napCount: recommendation.napCount,
    nap: recommendation.nap,
    totalNap: recommendation.totalNap,
    wakeWindow: recommendation.wakeWindow,
  };
}

function recommendationsEqual(
  left: Omit<SleepRecommendation, "ageMonths">,
  right: Omit<SleepRecommendation, "ageMonths">,
): boolean {
  return left.totalSleep.minimumMinutes === right.totalSleep.minimumMinutes
    && left.totalSleep.maximumMinutes === right.totalSleep.maximumMinutes
    && left.nightSleep.minimumMinutes === right.nightSleep.minimumMinutes
    && left.nightSleep.maximumMinutes === right.nightSleep.maximumMinutes
    && left.napCount.minimum === right.napCount.minimum
    && left.napCount.maximum === right.napCount.maximum
    && left.nap.minimumMinutes === right.nap.minimumMinutes
    && left.nap.maximumMinutes === right.nap.maximumMinutes
    && left.totalNap.minimumMinutes === right.totalNap.minimumMinutes
    && left.totalNap.maximumMinutes === right.totalNap.maximumMinutes
    && left.wakeWindow.minimumMinutes === right.wakeWindow.minimumMinutes
    && left.wakeWindow.maximumMinutes === right.wakeWindow.maximumMinutes;
}
