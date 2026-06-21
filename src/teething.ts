import type { AgeInterval, Tooth, ToothChartItem, ToothDescriptor, ToothJaw, ToothMapItem, ToothName, ToothSide, ToothState } from "./types.js";

export const BABY_DAYBOOK_TOOTH_NAMES = [
  "central_incisor",
  "lateral_incisor",
  "canine",
  "first_molar",
  "second_molar",
] as const satisfies readonly ToothName[];

export const BABY_DAYBOOK_TOOTH_JAWS = ["upper", "lower"] as const satisfies readonly ToothJaw[];
export const BABY_DAYBOOK_TOOTH_SIDES = ["left", "right"] as const satisfies readonly ToothSide[];

export const BABY_DAYBOOK_TOOTH_COLORS: Readonly<Record<ToothName, string>> = {
  central_incisor: "#E96957",
  lateral_incisor: "#B3D865",
  canine: "#80D893",
  first_molar: "#86D3FF",
  second_molar: "#AB96EA",
};

const CHART_ORDER: Readonly<Record<ToothName, Readonly<Record<ToothJaw, number>>>> = {
  central_incisor: { upper: 2, lower: 1 },
  lateral_incisor: { upper: 3, lower: 4 },
  canine: { upper: 5, lower: 6 },
  first_molar: { upper: 7, lower: 8 },
  second_molar: { upper: 10, lower: 9 },
};

const ERUPTION_INTERVALS: Readonly<Record<ToothName, Readonly<Record<ToothJaw, AgeInterval>>>> = {
  central_incisor: { upper: months(8, 12), lower: months(6, 10) },
  lateral_incisor: { upper: months(9, 13), lower: months(10, 16) },
  canine: { upper: months(16, 22), lower: months(17, 23) },
  first_molar: { upper: months(13, 19), lower: months(14, 18) },
  second_molar: { upper: months(25, 31), lower: months(23, 31) },
};

const SHED_INTERVALS: Readonly<Record<ToothName, Readonly<Record<ToothJaw, AgeInterval>>>> = {
  central_incisor: { upper: years(6, 7), lower: years(6, 7) },
  lateral_incisor: { upper: years(7, 8), lower: years(7, 8) },
  canine: { upper: years(10, 12), lower: years(9, 12) },
  first_molar: { upper: years(9, 12), lower: years(9, 11) },
  second_molar: { upper: years(10, 12), lower: years(10, 12) },
};

export function toothUid(name: ToothName, jaw: ToothJaw, side: ToothSide): string {
  return `${name}_${jaw}_${side}`;
}

export function getToothEruptionInterval(name: ToothName, jaw: ToothJaw): AgeInterval {
  return { ...ERUPTION_INTERVALS[name][jaw] };
}

export function getToothShedInterval(name: ToothName, jaw: ToothJaw): AgeInterval {
  return { ...SHED_INTERVALS[name][jaw] };
}

export function getToothChartItem(name: ToothName, jaw: ToothJaw): ToothChartItem {
  return {
    order: CHART_ORDER[name][jaw],
    name,
    jaw,
    color: BABY_DAYBOOK_TOOTH_COLORS[name],
    erupts: getToothEruptionInterval(name, jaw),
    sheds: getToothShedInterval(name, jaw),
  };
}

export function listToothChartItems(): ToothChartItem[] {
  return BABY_DAYBOOK_TOOTH_NAMES
    .flatMap((name) => BABY_DAYBOOK_TOOTH_JAWS.map((jaw) => getToothChartItem(name, jaw)))
    .sort((left, right) => left.order - right.order);
}

export function listPrimaryTeeth(): ToothDescriptor[] {
  return BABY_DAYBOOK_TOOTH_NAMES.flatMap((name) => BABY_DAYBOOK_TOOTH_JAWS.flatMap((jaw) =>
    BABY_DAYBOOK_TOOTH_SIDES.map((side) => ({
      uid: toothUid(name, jaw, side),
      name,
      jaw,
      side,
      chartOrder: CHART_ORDER[name][jaw],
      color: BABY_DAYBOOK_TOOTH_COLORS[name],
      erupts: getToothEruptionInterval(name, jaw),
      sheds: getToothShedInterval(name, jaw),
    }))));
}

export function getToothState(tooth: Tooth | undefined): ToothState {
  if (tooth?.shed) return "shed";
  if (tooth?.erupted) return "erupted";
  return "none";
}

export function buildToothMap(teeth: readonly Tooth[]): ToothMapItem[] {
  const byUid = new Map(teeth.map((tooth) => [tooth.uid, tooth]));
  return listPrimaryTeeth().map((descriptor) => {
    const tooth = byUid.get(descriptor.uid) ?? teeth.find((candidate) =>
      candidate.name === descriptor.name && candidate.jaw === descriptor.jaw && candidate.side === descriptor.side);
    return { ...descriptor, state: getToothState(tooth), tooth };
  });
}

function months(from: number, to: number): AgeInterval {
  return { unit: "month", from, to };
}

function years(from: number, to: number): AgeInterval {
  return { unit: "year", from, to };
}
