import { BabyDaybookRestoreError } from "./errors.js";
import type { BabyDaybookRestoreOutcome, BabyDaybookRestoreRecordSection, BabyDaybookRestoreTarget } from "./types.js";

export interface BackupRestoreOperation {
  target: BabyDaybookRestoreTarget;
  restore: () => unknown | Promise<unknown>;
}

export function restoreRecordOperations<T extends { uid: string }>(
  section: BabyDaybookRestoreRecordSection,
  records: readonly T[],
  save: (record: T) => unknown | Promise<unknown>,
): BackupRestoreOperation[] {
  return records.map((record) => ({ target: { section, uid: record.uid }, restore: () => save(record) }));
}

export async function runBackupRestore(prerequisites: BackupRestoreOperation[], records: BackupRestoreOperation[]): Promise<void> {
  const operations = [...prerequisites, ...records];
  const outcomes: BabyDaybookRestoreOutcome[] = operations.map(({ target }) => ({ target, status: "not-started" }));
  const settle = async (start: number, count: number): Promise<void> => {
    const results = await Promise.allSettled(operations.slice(start, start + count).map(({ restore }) => Promise.resolve().then(restore)));
    for (const [offset, result] of results.entries()) {
      const target = operations[start + offset]!.target;
      outcomes[start + offset] = result.status === "fulfilled"
        ? { target, status: "fulfilled" }
        : { target, status: "rejected", reason: result.reason };
    }
    if (results.some((result) => result.status === "rejected")) throw new BabyDaybookRestoreError(outcomes);
  };
  for (let index = 0; index < prerequisites.length; index += 1) await settle(index, 1);
  await settle(prerequisites.length, records.length);
}
