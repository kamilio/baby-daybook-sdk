import { describe, expect, it, vi } from "vitest";
import { decodeBaby, encodeBaby, encodeNativeFlag, normalizeNativeFlag } from "../src/index.js";
import { ToothRepository } from "../src/tooth-records.js";
import type { Baby, FirestoreClient, Tooth } from "../src/index.js";

describe("native record flag codecs", () => {
  it("normalizes profile flags and persists their native integer representation", () => {
    const native = baby({ isPremature: 1, convertUnits: 0, sleepPredictionEnabled: 1 } as unknown as Partial<Baby>);
    const decoded = decodeBaby(native);

    expect(decoded).toMatchObject({ isPremature: true, convertUnits: false, sleepPredictionEnabled: true });
    expect(encodeBaby(decoded)).toMatchObject({ isPremature: 1, convertUnits: 0, sleepPredictionEnabled: 1 });

    const cleared = encodeBaby({ ...decoded, convertUnits: undefined });
    expect(Object.hasOwn(cleared, "convertUnits")).toBe(true);
    expect(cleared.convertUnits).toBeUndefined();
    expect(Object.hasOwn(encodeBaby(baby()), "convertUnits")).toBe(false);
  });

  it("applies the tooth flag codec at the repository boundary", async () => {
    const set = vi.fn(async (_path: string, data: Record<string, unknown>) => ({ data }));
    const repository = new ToothRepository({ set } as unknown as FirestoreClient, "babies/baby/teething");
    const tooth: Tooth = {
      uid: "canine_lower_right",
      userUid: "user",
      babyUid: "baby",
      name: "canine",
      jaw: "lower",
      side: "right",
      erupted: true,
      shed: false,
    };

    const saved = await repository.save(tooth);

    expect(set.mock.calls[0]?.[1]).toMatchObject({ erupted: 1, shed: 0 });
    expect(saved).toMatchObject({ erupted: true, shed: false });

    await repository.save({ ...tooth, erupted: undefined });
    expect(Object.hasOwn(set.mock.calls[1]![1], "erupted")).toBe(true);
    expect(set.mock.calls[1]![1].erupted).toBeUndefined();
  });

  it.each([null, 2, "true"])("rejects invalid native boolean flag values (%j)", (value) => {
    expect(() => normalizeNativeFlag(value)).toThrow(/native boolean flag/i);
    expect(() => encodeNativeFlag(value)).toThrow(/native boolean flag/i);
  });
});

function baby(update: Partial<Baby> = {}): Baby {
  return { uid: "baby", userUid: "user", name: "Baby", ...update };
}
