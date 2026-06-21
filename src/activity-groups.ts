import type { ActivityGroup } from "./types.js";

export function sortActivityGroups(groups: readonly ActivityGroup[]): ActivityGroup[] {
  return groups
    .filter((group) => !group.deleted)
    .sort((left, right) => compareText(left.daType ?? "", right.daType ?? "") || compareText(left.title, right.title, true));
}

export function hasActivityGroupWithSameName(
  groups: readonly ActivityGroup[],
  daType: string,
  title: string,
  excludingUid?: string,
): boolean {
  const normalizedTitle = title.toLowerCase();
  return groups.some((group) => !group.deleted
    && group.daType === daType
    && group.uid !== excludingUid
    && group.title.toLowerCase() === normalizedTitle);
}

function compareText(left: string, right: string, caseInsensitive = false): number {
  const normalizedLeft = caseInsensitive ? left.toLowerCase() : left;
  const normalizedRight = caseInsensitive ? right.toLowerCase() : right;
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}
