import { describe, expect, it, vi } from "vitest";
import { createCLICommandTreeSnapshot } from "toolcraft/cli";
import { babyDaybookCommands, createBabyDaybookToolcraftSDK } from "../src/toolcraft.js";
import type { BabyDaybookCommandService } from "../src/command-service.js";

describe("Baby Daybook Toolcraft commands", () => {
  it("publishes the complete CLI tree", async () => {
    const snapshot = await createCLICommandTreeSnapshot(babyDaybookCommands, {
      casing: "kebab",
      controls: { output: true, debug: true, verbose: true, yes: true },
      version: "0.1.0",
    });
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.root.children.map((child) => child.name)).toEqual([
      "session",
      "account",
      "babies",
      "activities",
      "activity-types",
      "groups",
      "growth",
      "moments",
      "notes",
      "teeth",
      "reminders",
      "settings",
      "caregivers",
      "attachments",
      "search",
      "statistics",
      "sleep",
      "export",
      "backup",
      "sync",
    ]);
    expect(countCommands(snapshot.root)).toBe(72);
    expect(snapshot.globalOptions.map((option) => option.flags[0])).toEqual([
      "-h",
      "--yes",
      "--output",
      "--debug",
      "-v",
      "--version",
    ]);
  });

  it("runs session status through the typed Toolcraft SDK", async () => {
    const sdk = createBabyDaybookToolcraftSDK({ services: { babyDaybook: commandService({
      auth: { getAccount: vi.fn(async () => ({ email: "parent@example.com", emailVerified: true, displayName: "Parent", providerUserInfo: [{ providerId: "password" }] })) },
      session: {},
      getUser: vi.fn(async () => ({ uid: "user", displayName: "Parent" })),
      listBabies: vi.fn(async () => [{ uid: "baby" }]),
    }) } });
    await expect(sdk.session.status({})).resolves.toEqual({ data: {
      authenticated: true,
      displayName: "Parent",
      hasEmail: true,
      emailVerified: true,
      providers: ["password"],
      babyCount: 1,
    } });
  });

  it("passes list options through the shared SDK pipeline", async () => {
    const listBabies = vi.fn(async () => [{ uid: "baby", name: "Baby" }]);
    const sdk = createBabyDaybookToolcraftSDK({ services: { babyDaybook: commandService({ listBabies }) } });
    await expect(sdk.babies.list({ includeDeleted: true })).resolves.toEqual({ data: [{ uid: "baby", name: "Baby" }] });
    expect(listBabies).toHaveBeenCalledWith({ includeDeleted: true });
  });

  it("rejects malformed JSON patches before writing", async () => {
    const save = vi.fn();
    const sdk = createBabyDaybookToolcraftSDK({ services: { babyDaybook: commandService({ baby: vi.fn(() => ({ save })) }) } });
    await expect(sdk.babies.update({ babyUid: "baby", patchJson: "[]" })).rejects.toThrow("patchJson must be a JSON object");
    expect(save).not.toHaveBeenCalled();
  });

  it("executes every declared command handler through the SDK", async () => {
    const snapshot = await createCLICommandTreeSnapshot(babyDaybookCommands, { casing: "kebab" });
    const sdk = createBabyDaybookToolcraftSDK({
      services: { babyDaybook: commandService(universalClient()) },
    }) as Record<string, unknown>;
    for (const command of commands(snapshot.root)) {
      let target: unknown = sdk;
      for (const segment of command.path) target = (target as Record<string, unknown>)[camelCase(segment)];
      expect(typeof target, command.path.join(" ")).toBe("function");
      await expect((target as (params: Record<string, unknown>) => Promise<unknown>)(sampleParams(command))).resolves.toBeDefined();
    }
  });
});

function commandService(client: Record<string, unknown>): BabyDaybookCommandService {
  return { connect: vi.fn(async () => ({ client, authFile: "/test/auth.json" })) as unknown as BabyDaybookCommandService["connect"] };
}

function countCommands(node: { kind: string; children?: Array<any> }): number {
  if (node.kind === "command") return 1;
  return (node.children ?? []).reduce((total, child) => total + countCommands(child), 0);
}

function commands(node: any): any[] {
  if (node.kind === "command") return [node];
  return node.children.flatMap(commands);
}

function sampleParams(command: any): Record<string, unknown> {
  return Object.fromEntries(command.options.map((option: any) => [option.name, sampleValue(command.path, option)]));
}

function sampleValue(path: string[], option: any): unknown {
  if (option.choices?.length) {
    if (option.name === "setting") return "notifications";
    if (option.name === "category") return "moments";
    if (option.name === "interval") return "last7Days";
    if (option.name === "reminderType") return "basic";
    return option.choices[0];
  }
  if (option.type === "boolean") return true;
  if (option.type === "number") {
    if (option.name === "toMillis") return 200;
    if (["napCount", "daytimeStartMinutes"].includes(option.name)) return 0;
    if (option.name === "daytimeEndMinutes") return 720;
    if (option.name === "limit") return 1;
    return 100;
  }
  const values: Record<string, string> = {
    babyUid: "baby",
    uid: "record",
    itemUid: "record",
    caregiverUid: "caregiver",
    name: path[0] === "teeth" ? "central_incisor" : "Baby",
    title: "Title",
    displayName: "Parent",
    email: "caregiver@example.com",
    type: "sleeping",
    note: "Daily note",
    query: "query",
    patchJson: "{}",
    valueJson: "true",
    backupJson: "{}",
    dataBase64: "YQ==",
    fileName: "00000000-0000-4000-8000-000000000000.jpg",
    contentType: "image/jpeg",
    timeZone: "UTC",
    side: "left",
    reaction: "liked",
    jaw: "lower",
    category: "moments",
    setting: "notifications",
    reminderType: "basic",
    interval: "last7Days",
  };
  return values[option.name] ?? "value";
}

function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function universalClient(): Record<string, unknown> {
  const record = { uid: "record", userUid: "user", babyUid: "baby", name: "Baby", title: "Title", type: "sleeping", dateMillis: 100 };
  const repository = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => record),
    save: vi.fn(async (value) => value),
  };
  const baby = new Proxy({
    activityTypes: repository,
    activities: repository,
    groups: repository,
    growth: repository,
    moments: repository,
    reminders: repository,
    get: vi.fn(async () => record),
    getStatisticsDateRange: vi.fn(async () => ({ range: { fromMillis: 100, toMillis: 200 } })),
    getDaytimeRange: vi.fn(async () => ({ start: { hour: 6, minute: 0 }, end: { hour: 18, minute: 0 } })),
    areNotificationsEnabled: vi.fn(async () => true),
    isQuickAddNotificationEnabled: vi.fn(async () => true),
    listStickyNotifications: vi.fn(async () => []),
    getSleepPredictionNotificationMinutes: vi.fn(async () => 15),
    getDaTypesConfig: vi.fn(async () => []),
    fileMetadata: vi.fn(() => repository),
    downloadAttachment: vi.fn(async () => new Uint8Array([1])),
    exportActivitiesCsv: vi.fn(async () => "csv"),
    exportActivitiesPdf: vi.fn(async () => new Uint8Array([1])),
    exportGrowthPdf: vi.fn(async () => new Uint8Array([1])),
    exportTimelinePdf: vi.fn(async () => new Uint8Array([1])),
    watch: vi.fn(() => (async function* () { yield []; })()),
  }, {
    get(target, property, receiver) {
      if (property === "then") return undefined;
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      return vi.fn(async (...args: unknown[]) => {
        if (String(property).startsWith("list") || String(property).startsWith("search") || String(property).includes("Schedules") || String(property).includes("Items")) return [];
        return args[0] && typeof args[0] === "object" ? args[0] : record;
      });
    },
  });
  const family = new Proxy({}, { get: (_target, property) => property === "then" ? undefined : vi.fn(async () => undefined) });
  return new Proxy({
    auth: { getAccount: vi.fn(async () => ({ email: "parent@example.com", emailVerified: true, providerUserInfo: [] })) },
    session: {},
    family,
    baby: vi.fn(() => baby),
    getUser: vi.fn(async () => record),
    listBabies: vi.fn(async () => []),
    getBaby: vi.fn(async () => record),
  }, {
    get(target, property, receiver) {
      if (property === "then") return undefined;
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      return vi.fn(async (...args: unknown[]) => args[0] && typeof args[0] === "object" ? args[0] : record);
    },
  });
}
