import { describe, expect, it } from "vitest";
import {
  BABY_DAYBOOK_TOOTH_COLORS,
  buildToothMap,
  getToothEruptionInterval,
  getToothShedInterval,
  getToothState,
  listPrimaryTeeth,
  listToothChartItems,
  toothUid,
} from "../src/index.js";
import type { Tooth } from "../src/index.js";

describe("native teething chart", () => {
  it("reproduces native identifiers, colors, and age intervals", () => {
    expect(toothUid("central_incisor", "upper", "left")).toBe("central_incisor_upper_left");
    expect(BABY_DAYBOOK_TOOTH_COLORS).toEqual({
      central_incisor: "#E96957",
      lateral_incisor: "#B3D865",
      canine: "#80D893",
      first_molar: "#86D3FF",
      second_molar: "#AB96EA",
    });
    expect(getToothEruptionInterval("central_incisor", "upper")).toEqual({ unit: "month", from: 8, to: 12 });
    expect(getToothEruptionInterval("central_incisor", "lower")).toEqual({ unit: "month", from: 6, to: 10 });
    expect(getToothEruptionInterval("second_molar", "upper")).toEqual({ unit: "month", from: 25, to: 31 });
    expect(getToothEruptionInterval("second_molar", "lower")).toEqual({ unit: "month", from: 23, to: 31 });
    expect(getToothShedInterval("canine", "upper")).toEqual({ unit: "year", from: 10, to: 12 });
    expect(getToothShedInterval("canine", "lower")).toEqual({ unit: "year", from: 9, to: 12 });
    expect(getToothShedInterval("first_molar", "lower")).toEqual({ unit: "year", from: 9, to: 11 });
  });

  it("returns the native ten-row chart order", () => {
    expect(listToothChartItems().map(({ order, name, jaw }) => [order, name, jaw])).toEqual([
      [1, "central_incisor", "lower"],
      [2, "central_incisor", "upper"],
      [3, "lateral_incisor", "upper"],
      [4, "lateral_incisor", "lower"],
      [5, "canine", "upper"],
      [6, "canine", "lower"],
      [7, "first_molar", "upper"],
      [8, "first_molar", "lower"],
      [9, "second_molar", "lower"],
      [10, "second_molar", "upper"],
    ]);
  });

  it("builds all twenty positions with shed-over-erupted state precedence", () => {
    expect(listPrimaryTeeth()).toHaveLength(20);
    expect(new Set(listPrimaryTeeth().map((tooth) => tooth.uid)).size).toBe(20);
    const records: Tooth[] = [
      tooth({ uid: "central_incisor_upper_left", name: "central_incisor", jaw: "upper", side: "left", erupted: true }),
      tooth({ uid: "legacy", name: "canine", jaw: "lower", side: "right", erupted: true, shed: true }),
    ];
    const map = buildToothMap(records);
    expect(map.find((item) => item.uid === "central_incisor_upper_left")).toMatchObject({ state: "erupted", tooth: records[0] });
    expect(map.find((item) => item.uid === "canine_lower_right")).toMatchObject({ state: "shed", tooth: records[1] });
    expect(map.find((item) => item.uid === "second_molar_upper_right")).toMatchObject({ state: "none" });
    expect(getToothState(undefined)).toBe("none");
  });
});

function tooth(overrides: Partial<Tooth>): Tooth {
  return {
    uid: "tooth",
    userUid: "user",
    babyUid: "baby",
    name: "central_incisor",
    jaw: "upper",
    side: "left",
    ...overrides,
  };
}
