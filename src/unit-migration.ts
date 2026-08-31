import { decodeBaby } from "./baby-records.js";
import type { BabyClient } from "./client.js";
import type { FirestoreClient } from "./firestore.js";
import { normalizeNativeFlag } from "./native-flags.js";
import { paths } from "./paths.js";
import type { Baby, BabyDaybookBackup, BabyUnitMigrationOptions, BabyUnitMigrationResult, BabyUnitMigrationSourceUnits, FirestoreDocument } from "./types.js";
import { convertValueToMetric, type UnitType } from "./units.js";

const FIELD_OPTIONS = {
  temperature: "temperatureFahrenheit",
  volume: "volumeFluidOunces",
  weight: "growthWeightPoundsAndOunces",
  height: "growthHeightInches",
  headSize: "growthHeadSizeInches",
} as const;

interface RecordPlan {
  source: Record<string, unknown>;
  target: Record<string, number | undefined>;
}

interface CollectionPlan {
  path: string;
  fields: UnitType[];
  records: Map<string, RecordPlan>;
}

export async function migrateBabyUnitsToMetric(client: BabyClient, options: BabyUnitMigrationOptions): Promise<BabyUnitMigrationResult> {
  if (typeof options.loadBackup !== "function") throw new TypeError("Unit migration requires loadBackup to resume from the original durable backup");
  if (typeof options.persistBackup !== "function") throw new TypeError("Unit migration requires persistBackup to durably create the original backup");
  const sourceUnits = Object.fromEntries(Object.values(FIELD_OPTIONS).map((key) => {
    if (typeof options[key] !== "boolean") throw new TypeError(`Unit migration source units require a boolean ${key}`);
    return [key, options[key]];
  })) as unknown as BabyUnitMigrationSourceUnits;
  const firestore = client.client.firestore;
  const babyPath = paths.baby(client.babyUid);
  const loadedValue = await options.loadBackup();
  const loaded = loadedValue === undefined ? undefined : structuredClone(loadedValue);
  const profile = await firestore.get<Baby>(babyPath);
  if (!profile) throw new Error(`Baby ${client.babyUid} does not exist`);
  if (loaded === undefined && normalizeNativeFlag(profile.data.convertUnits)) {
    throw new Error("Baby already uses metric units; no original migration backup is available");
  }
  const backup = loaded === undefined
    ? { ...await client.createBackup({ includeAttachments: false }), unitMigration: { version: 1 as const, sourceUnits } }
    : loaded;
  validateBackup(backup, client.babyUid, sourceUnits);
  const collections = [
    buildCollectionPlan(paths.babyCollection(client.babyUid, "dailyActions"), backup.activities, ["temperature", "volume"], sourceUnits, client.babyUid),
    buildCollectionPlan(paths.babyCollection(client.babyUid, "growth"), backup.growth, ["weight", "height", "headSize"], sourceUnits, client.babyUid),
  ];
  if (loaded === undefined) await options.persistBackup(structuredClone(backup));
  if (normalizeNativeFlag(profile.data.convertUnits)) {
    return { baby: decodeBaby(profile.data), backup, convertedActivities: 0, convertedGrowthEntries: 0 };
  }
  requireRevision(profile);
  for (const collection of collections) await checkCurrentRecords(firestore, collection, false);
  const convertedCounts: number[] = [];
  for (const collection of collections) {
    let convertedCount = 0;
    for (const [uid, plan] of collection.records) {
      const path = `${collection.path}/${uid}`;
      const current = await firestore.get<Record<string, unknown>>(path);
      if (!current || normalizeNativeFlag(current.data.deleted)) continue;
      const patch = conversionPatch(plan, current.data, path);
      if (Object.keys(patch).length === 0) continue;
      await firestore.setMany([{ path, data: patch, merge: true, updateTime: requireRevision(current) }]);
      convertedCount += 1;
    }
    convertedCounts.push(convertedCount);
  }
  for (const collection of collections) await checkCurrentRecords(firestore, collection, true);
  const currentProfile = await firestore.get<Baby>(babyPath);
  if (!currentProfile) throw new Error(`Baby ${client.babyUid} does not exist`);
  if (!normalizeNativeFlag(currentProfile.data.convertUnits)) {
    await firestore.setMany([{
      path: babyPath,
      data: { convertUnits: 1, updatedMillis: options.atMillis ?? Date.now() },
      merge: true,
      updateTime: requireRevision(currentProfile),
    }]);
  }
  const baby = await client.get();
  if (!baby) throw new Error(`Baby ${client.babyUid} does not exist`);
  return { baby, backup, convertedActivities: convertedCounts[0]!, convertedGrowthEntries: convertedCounts[1]! };
}

function validateBackup(backup: BabyDaybookBackup, babyUid: string, units: BabyUnitMigrationSourceUnits): void {
  if (!backup || backup.format !== "baby-daybook-sdk-backup" || backup.version !== 2 || backup.unitMigration?.version !== 1) {
    throw new Error("Invalid unit migration backup; keep the original recovery file");
  }
  if (backup.baby?.uid !== babyUid) throw new Error(`Unit migration backup belongs to a different baby, not ${babyUid}`);
  if (normalizeNativeFlag(backup.baby.convertUnits)) throw new Error("Unit migration backup already contains metric data");
  for (const key of Object.values(FIELD_OPTIONS)) {
    if (backup.unitMigration.sourceUnits?.[key] !== units[key]) throw new Error("Unit migration source units differ from the original backup");
  }
}

function buildCollectionPlan(path: string, records: unknown, fields: UnitType[], units: BabyUnitMigrationSourceUnits, babyUid: string): CollectionPlan {
  if (!Array.isArray(records)) throw new Error(`Invalid migration backup records for ${path}`);
  const selected = fields.filter((field) => units[FIELD_OPTIONS[field]]);
  const plans = new Map<string, RecordPlan>();
  const ids = new Set<string>();
  for (const record of records) {
    if (!record || typeof record.uid !== "string" || !record.uid || record.babyUid !== babyUid || ids.has(record.uid)) {
      throw new Error(`Invalid or duplicate record in migration backup for ${path}`);
    }
    ids.add(record.uid);
    if (normalizeNativeFlag(record.deleted)) continue;
    const target = Object.fromEntries(selected.map((field) => {
      const value = record[field];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error(`Invalid ${field} in migration backup for ${record.uid}`);
      }
      const converted = value === undefined || value === 0 ? value : convertValueToMetric(value, field);
      if (converted !== undefined && !Number.isFinite(converted)) throw new Error(`Invalid converted ${field} in migration backup for ${record.uid}`);
      return [field, converted];
    }));
    plans.set(record.uid, { source: record, target });
  }
  return { path, fields: selected, records: plans };
}

function conversionPatch(plan: RecordPlan, current: Record<string, unknown>, path: string): Record<string, number> {
  const patch: Record<string, number> = {};
  for (const [field, target] of Object.entries(plan.target)) {
    const source = plan.source[field];
    const value = current[field];
    if (value === target || ((source === undefined || source === 0) && (value === undefined || value === 0))) continue;
    if (value !== source || target === undefined) throw new Error(`Unit migration conflict at ${path}.${field}; reconcile with the original backup before retrying`);
    patch[field] = target;
  }
  return patch;
}

async function checkCurrentRecords(firestore: FirestoreClient, collection: CollectionPlan, completed: boolean): Promise<void> {
  const documents = await firestore.list<Record<string, unknown>>(collection.path, { includeDeleted: true });
  for (const document of documents) {
    if (normalizeNativeFlag(document.data.deleted)) continue;
    const plan = collection.records.get(document.id);
    if (!plan) {
      if (collection.fields.some((field) => document.data[field] !== undefined && document.data[field] !== 0)) {
        throw new Error(`Record ${document.path} is not in the original migration backup; pause other writers and reconcile it before retrying`);
      }
      continue;
    }
    const patch = conversionPatch(plan, document.data, document.path);
    if (completed && Object.keys(patch).length > 0) throw new Error(`Unit migration conflict at ${document.path}; values changed during conversion, retry from the original backup`);
  }
}

function requireRevision(document: FirestoreDocument<unknown>): string {
  if (!document.updateTime) throw new Error(`Cannot migrate ${document.path} without its Firestore updateTime`);
  return document.updateTime;
}
