import { describe, expect, it, vi } from "vitest";
import { AuthSession, BabyClient, BabyDaybookClient } from "../src/index.js";
import {
  babyDaytimeRangeDurationMinutes,
  clampBabyDaytimeRange,
  formatBabyDaytimeRange,
  parseBabyDaytimeRange,
  roundBabyDaytimeRange,
  validateBabyDaytimeRange,
} from "../src/daytime-range.js";
import type { Baby } from "../src/types.js";

describe("Baby daytime ranges", () => {
  it("parses persisted values and falls back to the app default", () => {
    expect(parseBabyDaytimeRange("04:15-18:15")).toEqual({ start: { hour: 4, minute: 15 }, end: { hour: 18, minute: 15 } });
    expect(parseBabyDaytimeRange()).toEqual({ start: { hour: 7, minute: 0 }, end: { hour: 20, minute: 0 } });
    expect(parseBabyDaytimeRange("bad")).toEqual({ start: { hour: 7, minute: 0 }, end: { hour: 20, minute: 0 } });
    expect(parseBabyDaytimeRange("03:00-17:00")).toEqual({ start: { hour: 7, minute: 0 }, end: { hour: 20, minute: 0 } });
  });

  it("formats padded values and rejects invalid clock times", () => {
    expect(formatBabyDaytimeRange({ start: { hour: 4, minute: 5 }, end: { hour: 18, minute: 5 } })).toBe("04:05-18:05");
    expect(() => formatBabyDaytimeRange({ start: { hour: 24, minute: 0 }, end: { hour: 18, minute: 0 } })).toThrow(RangeError);
  });

  it("matches the inclusive bounds and circular duration rules", () => {
    expect(validateBabyDaytimeRange({ start: { hour: 4, minute: 0 }, end: { hour: 15, minute: 0 } })).toMatchObject({ valid: true });
    expect(validateBabyDaytimeRange({ start: { hour: 8, minute: 0 }, end: { hour: 22, minute: 0 } })).toMatchObject({ valid: true });
    expect(validateBabyDaytimeRange({ start: { hour: 3, minute: 59 }, end: { hour: 17, minute: 59 } })).toMatchObject({ startInBounds: false, valid: false });
    expect(validateBabyDaytimeRange({ start: { hour: 8, minute: 0 }, end: { hour: 22, minute: 1 } })).toMatchObject({ endInBounds: false, valid: false });
    expect(validateBabyDaytimeRange({ start: { hour: 7, minute: 0 }, end: { hour: 17, minute: 59 } })).toMatchObject({ durationAtLeastMinimum: false, valid: false });
    expect(validateBabyDaytimeRange({ start: { hour: 7, minute: 0 }, end: { hour: 21, minute: 1 } })).toMatchObject({ durationAtMostMaximum: false, valid: false });
    expect(babyDaytimeRangeDurationMinutes({ start: { hour: 20, minute: 0 }, end: { hour: 7, minute: 0 } })).toBe(660);
    expect(babyDaytimeRangeDurationMinutes({ start: { hour: 7, minute: 0 }, end: { hour: 7, minute: 0 } })).toBe(0);
  });

  it("rounds to 15 minutes with halfway values rounded up", () => {
    expect(roundBabyDaytimeRange({ start: { hour: 7, minute: 7 }, end: { hour: 19, minute: 8 } })).toEqual({
      start: { hour: 7, minute: 0 },
      end: { hour: 19, minute: 15 },
    });
    expect(roundBabyDaytimeRange({ start: { hour: 23, minute: 53 }, end: { hour: 12, minute: 0 } }).start).toEqual({ hour: 0, minute: 0 });
  });

  it("clamps duration while preserving the changed edge", () => {
    const current = { start: { hour: 7, minute: 0 }, end: { hour: 20, minute: 0 } };
    expect(clampBabyDaytimeRange(current, { start: { hour: 10, minute: 0 }, end: { hour: 20, minute: 0 } })).toEqual({
      start: { hour: 10, minute: 0 },
      end: { hour: 21, minute: 0 },
    });
    expect(clampBabyDaytimeRange(current, { start: { hour: 7, minute: 0 }, end: { hour: 17, minute: 0 } })).toEqual({
      start: { hour: 6, minute: 0 },
      end: { hour: 17, minute: 0 },
    });
    expect(clampBabyDaytimeRange(current, { start: { hour: 4, minute: 0 }, end: { hour: 20, minute: 0 } })).toEqual({
      start: { hour: 4, minute: 0 },
      end: { hour: 18, minute: 0 },
    });
    expect(clampBabyDaytimeRange(current, { start: { hour: 7, minute: 0 }, end: { hour: 22, minute: 0 } })).toEqual({
      start: { hour: 8, minute: 0 },
      end: { hour: 22, minute: 0 },
    });
    expect(clampBabyDaytimeRange(current, { start: { hour: 12, minute: 0 }, end: { hour: 20, minute: 0 } })).toEqual({
      start: { hour: 11, minute: 0 },
      end: { hour: 22, minute: 0 },
    });
    expect(clampBabyDaytimeRange(current, { start: { hour: 7, minute: 0 }, end: { hour: 14, minute: 0 } })).toEqual({
      start: { hour: 4, minute: 0 },
      end: { hour: 15, minute: 0 },
    });
  });

  it("reads and persists ranges through BabyClient", async () => {
    const babyData: Baby = { uid: "baby", userUid: "user", name: "Baby", daytimeRange: "07:00-20:00" };
    const client = new BabyDaybookClient({
      session: new AuthSession({ idToken: "id", userId: "user", expiresAt: Date.now() + 3_600_000 }),
      fetch: vi.fn() as never,
    });
    vi.spyOn(client, "getBaby").mockResolvedValue(babyData);
    const set = vi.fn(async (_path: string, data: Record<string, unknown>) => ({ data }));
    Object.defineProperty(client, "firestore", { value: { set } });
    const baby = new BabyClient(client, "baby");

    await expect(baby.getDaytimeRange()).resolves.toEqual({ start: { hour: 7, minute: 0 }, end: { hour: 20, minute: 0 } });
    await expect(baby.setDaytimeRange({ start: { hour: 6, minute: 30 }, end: { hour: 19, minute: 30 } })).resolves.toMatchObject({
      daytimeRange: "06:30-19:30",
    });
    await expect(baby.setDaytimeRange({ start: { hour: 3, minute: 0 }, end: { hour: 17, minute: 0 } })).rejects.toThrow(RangeError);
  });
});
