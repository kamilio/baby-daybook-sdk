import { describe, expect, it, vi } from "vitest";
import { BabyClient } from "../src/client.js";
import {
  BABY_DAYBOOK_DEFAULT_REMINDER_INTERVAL_MILLIS,
  BABY_DAYBOOK_RELEVANT_REMINDER_LEAD_MILLIS,
  getEarliestReminderDisplayMillis,
  getExpiredReminderMillis,
  getNextReminderMillis,
  getRelevantReminderSchedules,
  isReminderMillisInDnd,
  normalizeReminderForSave,
  parseReminderWeekdays,
  resolveReminderSchedule,
  sortReminderSchedules,
} from "../src/reminders.js";
import type { ActivityType, DailyAction, Reminder } from "../src/types.js";

describe("Baby Daybook reminder scheduling", () => {
  it("normalizes editor fields exactly when saving each native reminder type", () => {
    const base = makeReminder({
      intervalMillis: BABY_DAYBOOK_DEFAULT_REMINDER_INTERVAL_MILLIS,
      repeatDays: 0,
      repeatWeekdays: "1,3",
      dndFrom: "22:00",
      dndTo: "07:00",
      dismissedMillis: 123,
    });

    expect(normalizeReminderForSave({ ...base, type: "basic", dateMillis: 999 })).toMatchObject({
      dateMillis: 0,
      intervalMillis: BABY_DAYBOOK_DEFAULT_REMINDER_INTERVAL_MILLIS,
      repeatDays: 0,
      repeatWeekdays: "",
      dndFrom: "22:00",
      dndTo: "07:00",
      dismissedMillis: 0,
    });
    expect(normalizeReminderForSave({ ...base, type: "advanced", dateMillis: 999 })).toMatchObject({
      dateMillis: 999,
      intervalMillis: 0,
      repeatDays: 0,
      repeatWeekdays: "",
      dndFrom: "",
      dndTo: "",
      dismissedMillis: 0,
    });
    expect(normalizeReminderForSave({ ...base, type: "advanced_repeat_days", dateMillis: 999 })).toMatchObject({
      repeatDays: 1,
      repeatWeekdays: "",
    });
    expect(normalizeReminderForSave({ ...base, type: "advanced_repeat_weekdays", dateMillis: 999 })).toMatchObject({
      repeatDays: 0,
      repeatWeekdays: "1,3",
    });
  });

  it("resolves one-time reminders and honors dismissal and later activity", () => {
    const due = localMillis(2026, 7, 6, 9);
    const now = localMillis(2026, 7, 6, 10);
    const reminder = makeReminder({ type: "advanced", dateMillis: due });

    expect(getExpiredReminderMillis(reminder, { nowMillis: now })).toBe(due);
    expect(getNextReminderMillis(reminder, { nowMillis: now })).toBeUndefined();
    expect(getExpiredReminderMillis({ ...reminder, dismissedMillis: due }, { nowMillis: now })).toBeUndefined();
    expect(getExpiredReminderMillis(reminder, {
      nowMillis: now,
      lastActivity: makeActivity({ startMillis: due + 1 }),
    })).toBeUndefined();
  });

  it("advances repeat-day reminders by local calendar days", () => {
    const start = localMillis(2026, 3, 7, 9);
    const now = localMillis(2026, 3, 10, 10);
    const reminder = makeReminder({
      type: "advanced_repeat_days",
      dateMillis: start,
      repeatDays: 3,
    });

    expect(getExpiredReminderMillis(reminder, { nowMillis: now })).toBe(localMillis(2026, 3, 10, 9));
    expect(getNextReminderMillis(reminder, { nowMillis: now })).toBe(localMillis(2026, 3, 13, 9));
  });

  it("parses the app's comma-encoded weekday values", () => {
    expect(parseReminderWeekdays("1,3,0,3,bad,8")).toEqual([1, 3, 0]);
    expect(parseReminderWeekdays("")).toEqual([]);
  });

  it("selects previous and next configured weekdays at the original time", () => {
    const mondayAtNine = localMillis(2026, 7, 6, 9);
    const mondayAtTen = localMillis(2026, 7, 6, 10);
    const reminder = makeReminder({
      type: "advanced_repeat_weekdays",
      dateMillis: mondayAtNine,
      repeatWeekdays: "1,3",
    });

    expect(new Date(mondayAtTen).getDay()).toBe(1);
    expect(getExpiredReminderMillis(reminder, { nowMillis: mondayAtTen })).toBe(mondayAtNine);
    expect(getNextReminderMillis(reminder, { nowMillis: mondayAtTen })).toBe(localMillis(2026, 7, 8, 9));
  });

  it("uses activity end time for basic reminders and feeding start when configured", () => {
    const activity = makeActivity({
      type: "breastfeeding",
      startMillis: localMillis(2026, 7, 6, 8),
      endMillis: localMillis(2026, 7, 6, 8, 30),
    });
    const activityType = makeActivityType({ uid: "breastfeeding", category: "feeding", hasDuration: true });
    const reminder = makeReminder({ type: "basic", daType: "breastfeeding", intervalMillis: 2 * 60 * 60 * 1000 });

    expect(getNextReminderMillis(reminder, {
      nowMillis: localMillis(2026, 7, 6, 9),
      lastActivity: activity,
      activityType,
    })).toBe(localMillis(2026, 7, 6, 10, 30));
    expect(getNextReminderMillis(reminder, {
      nowMillis: localMillis(2026, 7, 6, 9),
      lastActivity: activity,
      activityType,
      lastFeedingFromStart: true,
    })).toBe(localMillis(2026, 7, 6, 10));
    expect(getNextReminderMillis(reminder, {
      nowMillis: localMillis(2026, 7, 6, 9),
      lastActivity: { ...activity, inProgress: true },
      activityType,
    })).toBeUndefined();
  });

  it("recognizes daytime and overnight DND windows", () => {
    expect(isReminderMillisInDnd({ dndFrom: "22:00", dndTo: "07:00" }, localMillis(2026, 7, 6, 23))).toBe(true);
    expect(isReminderMillisInDnd({ dndFrom: "22:00", dndTo: "07:00" }, localMillis(2026, 7, 6, 12))).toBe(false);
    expect(isReminderMillisInDnd({ dndFrom: "09:00", dndTo: "17:00" }, localMillis(2026, 7, 6, 12))).toBe(true);
    expect(isReminderMillisInDnd({ dndFrom: "bad", dndTo: "17:00" }, localMillis(2026, 7, 6, 12))).toBe(false);
  });

  it("annotates DND occurrences and sorts expired reminders first", () => {
    const now = localMillis(2026, 7, 6, 12);
    const expired = resolveReminderSchedule(makeReminder({
      uid: "expired",
      type: "advanced",
      dateMillis: localMillis(2026, 7, 6, 10),
      dndFrom: "09:00",
      dndTo: "11:00",
    }), { nowMillis: now });
    const upcoming = resolveReminderSchedule(makeReminder({
      uid: "upcoming",
      type: "advanced",
      dateMillis: localMillis(2026, 7, 6, 13),
    }), { nowMillis: now });

    expect(expired.expiredIsInDnd).toBe(true);
    expect(upcoming.nextIsInDnd).toBe(false);
    expect(sortReminderSchedules([upcoming, expired]).map((item) => item.reminder.uid)).toEqual(["expired", "upcoming"]);
  });

  it("shows native relevant reminders inside a strict thirty-minute window", () => {
    const now = localMillis(2026, 7, 6, 12);
    const expired = resolveReminderSchedule(makeReminder({ uid: "expired", dateMillis: now - 1 }), { nowMillis: now });
    const inside = resolveReminderSchedule(makeReminder({ uid: "inside", dateMillis: now + BABY_DAYBOOK_RELEVANT_REMINDER_LEAD_MILLIS - 1 }), { nowMillis: now });
    const boundary = resolveReminderSchedule(makeReminder({ uid: "boundary", dateMillis: now + BABY_DAYBOOK_RELEVANT_REMINDER_LEAD_MILLIS }), { nowMillis: now });
    const later = resolveReminderSchedule(makeReminder({ uid: "later", dateMillis: now + 45 * 60_000 }), { nowMillis: now });

    expect(getRelevantReminderSchedules([later, boundary, inside, expired], now).map((item) => item.reminder.uid)).toEqual(["expired", "inside"]);
    expect(getEarliestReminderDisplayMillis([inside, boundary, later], now)).toBe(now);
    expect(getEarliestReminderDisplayMillis([inside], now + 1)).toBeUndefined();
  });

  it("resolves baby schedules from the latest matching group activity", async () => {
    const now = localMillis(2026, 7, 6, 12);
    const basic = makeReminder({
      uid: "basic",
      type: "basic",
      daType: "bottle",
      groupUid: "formula",
      intervalMillis: 3 * 60 * 60 * 1000,
    });
    const expired = makeReminder({ uid: "expired", type: "advanced", dateMillis: now - 1_000 });
    const baby = Object.create(BabyClient.prototype) as BabyClient;
    Object.assign(baby, {
      reminders: { list: vi.fn(async () => [basic, expired]) },
      activities: { list: vi.fn(async () => [
        makeActivity({ uid: "old", type: "bottle", groupUid: "formula", startMillis: localMillis(2026, 7, 6, 7) }),
        makeActivity({ uid: "latest", type: "bottle", groupUid: "formula", startMillis: localMillis(2026, 7, 6, 10) }),
        makeActivity({ uid: "other-group", type: "bottle", groupUid: "milk", startMillis: localMillis(2026, 7, 6, 11) }),
      ]) },
      activityTypes: { list: vi.fn(async () => [makeActivityType({ uid: "bottle", category: "feeding" })]) },
    });

    const schedules = await baby.getReminderSchedules({ nowMillis: now });

    expect(schedules.map((item) => item.reminder.uid)).toEqual(["expired", "basic"]);
    expect(schedules[1]?.nextMillis).toBe(localMillis(2026, 7, 6, 13));
  });

  it("gets relevant schedules and dismisses reminders with native sync stamps", async () => {
    const now = localMillis(2026, 7, 6, 12);
    const reminder = makeReminder({ uid: "due", dateMillis: now - 1, svt: 4 });
    const save = vi.fn(async (item: Reminder) => item);
    const baby = Object.create(BabyClient.prototype) as BabyClient;
    Object.assign(baby, {
      reminders: { list: vi.fn(async () => [reminder]), get: vi.fn(async () => reminder), save },
      activities: { list: vi.fn(async () => []) },
      activityTypes: { list: vi.fn(async () => []) },
    });

    await expect(baby.getRelevantReminderSchedules({ nowMillis: now })).resolves.toEqual([
      expect.objectContaining({ reminder: expect.objectContaining({ uid: "due" }), expiredMillis: now - 1 }),
    ]);
    await expect(baby.dismissReminder("due", now)).resolves.toMatchObject({ dismissedMillis: now, updatedMillis: now, svt: 0 });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ uid: "due", dismissedMillis: now, updatedMillis: now, svt: 0 }));
  });
});

function localMillis(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function makeReminder(update: Partial<Reminder>): Reminder {
  return {
    uid: "reminder",
    userUid: "user",
    babyUid: "baby",
    type: "advanced",
    dateMillis: localMillis(2026, 7, 6, 9),
    ...update,
  };
}

function makeActivity(update: Partial<DailyAction>): DailyAction {
  return {
    uid: "activity",
    userUid: "user",
    babyUid: "baby",
    type: "other",
    startMillis: localMillis(2026, 7, 6, 8),
    ...update,
  };
}

function makeActivityType(update: Partial<ActivityType>): ActivityType {
  return {
    uid: "other",
    userUid: "user",
    babyUid: "baby",
    title: "Other",
    ...update,
  };
}
