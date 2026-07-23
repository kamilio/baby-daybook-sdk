import { describe, expect, it, vi } from "vitest";
import { createCLICommandTreeSnapshot } from "toolcraft/cli";
import { createMCPServer } from "toolcraft/mcp";
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
      "log",
      "timeline",
      "babies",
      "sleep",
      "journal",
      "reminders",
      "insights",
      "manage",
      "reports",
      "advanced",
    ]);
    const paths = commands(snapshot.root).map((command) => command.path.join("."));
    expect(paths).toEqual(CANONICAL_COMMAND_PATHS);
    expect(new Set(paths).size).toBe(79);
    expect(countCommands(snapshot.root)).toBe(79);
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
    await expect(sdk.manage.account.status({})).resolves.toEqual({ data: {
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

  it("exposes activity-type display titles without rewriting native titles", async () => {
    const list = vi.fn(async () => [{ uid: "bottle", userUid: "user", babyUid: "baby", title: "" }]);
    const sdk = createBabyDaybookToolcraftSDK({ services: { babyDaybook: commandService({
      baby: vi.fn(() => ({ activityTypes: { list } })),
    }) } });

    await expect(sdk.manage.activityTypes.list({ babyUid: "baby" })).resolves.toEqual({ data: [{
      uid: "bottle",
      userUid: "user",
      babyUid: "baby",
      title: "",
      displayTitle: "Bottle",
    }] });
  });

  it("rejects malformed JSON patches before writing", async () => {
    const save = vi.fn();
    const sdk = createBabyDaybookToolcraftSDK({ services: { babyDaybook: commandService({ baby: vi.fn(() => ({ save })) }) } });
    await expect(sdk.manage.babies.update({ babyUid: "baby", patchJson: "[]" })).rejects.toThrow("patchJson must be a JSON object");
    expect(save).not.toHaveBeenCalled();
  });

  it("logs a bottle through the same typed SDK handler with single-baby and feed resolution", async () => {
    const logBottle = vi.fn(async (input) => ({ uid: "logged", userUid: "user", babyUid: "baby", type: "bottle", ...input }));
    const sdk = createBabyDaybookToolcraftSDK({ services: { babyDaybook: commandService({
      listBabies: vi.fn(async () => [{ uid: "baby", name: "Michael" }]),
      baby: vi.fn(() => ({
        listGroups: vi.fn(async () => [{ uid: "formula", userUid: "user", babyUid: "baby", daType: "bottle", title: "Formula" }]),
        getLastActivity: vi.fn(async () => ({ groupUid: "formula" })),
        logBottle,
      })),
    }) } });

    await sdk.log.bottle({ volume: 5, volumeUnit: "fluidOunces" });

    expect(logBottle).toHaveBeenCalledWith(expect.objectContaining({
      groupUid: "formula",
      volume: expect.closeTo(147.8676477, 6),
    }));
  });

  it("rejects zero volumes and medicine amounts through the SDK schemas", async () => {
    const service = commandService({});
    const sdk = createBabyDaybookToolcraftSDK({ services: { babyDaybook: service } });

    await expect(sdk.log.pump({ volume: 0, side: "left" })).rejects.toThrow();
    await expect(sdk.log.bottle({ volume: 0 })).rejects.toThrow();
    await expect(sdk.log.medicine({ medicine: "Vitamin D", amount: 0, unit: "drops" })).rejects.toThrow();
    expect(service.connect).not.toHaveBeenCalled();
  });

  it("publishes truthful MCP effect metadata for every command", () => {
    const all = commandNodes(babyDaybookCommands);
    expect(all).toHaveLength(79);
    expect(all.every((command) => command.title && command.annotations)).toBe(true);
    expect(findCommand(all, "log", "bottle").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(findCommand(all, "timeline", "recent").annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(findCommand(all, "timeline", "timer", "stop").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(findCommand(all, "advanced", "raw", "activities", "update").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(findCommand(all, "advanced", "attachments", "upload")).toMatchObject({
      confirm: true,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    });
    expect(findCommand(all, "manage", "account", "delete").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });

    const openWorldPaths = new Set([
      "manage.account.send-email-verification",
      "manage.caregivers.invite",
      "manage.caregivers.cancel-invite",
      "manage.caregivers.remove",
      "manage.caregivers.transfer-primary",
      "manage.caregivers.accept",
      "manage.caregivers.decline",
      "manage.caregivers.leave",
    ]);
    for (const command of all) {
      expect(command.annotations.openWorldHint, command.commandPath.join(".")).toBe(openWorldPaths.has(command.commandPath.join(".")));
    }
  });

  it("publishes the matching canonical MCP tool names and schemas", async () => {
    const server = createMCPServer(babyDaybookCommands, {
      name: "baby-daybook-test",
      version: "0.1.0",
      omitRootToolNamePrefix: true,
      services: { babyDaybook: commandService({}) },
    });
    const session = server.createMessageSession(() => undefined);
    try {
      await session.handleMessage("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      });
      const response = await session.handleMessage("tools/list", {}) as any;
      const tools = response.result.tools as Array<any>;
      expect(tools.map((tool) => tool.name)).toEqual(CANONICAL_COMMAND_PATHS.map((path) => path.replaceAll("-", "_").replaceAll(".", "__")));
      expect(tools.find((tool) => tool.name === "log__bottle")).toMatchObject({
        title: "Log a bottle",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        outputSchema: { type: "object", required: ["activity"] },
      });
      expect(tools.find((tool) => tool.name === "advanced__backup__restore")).toMatchObject({
        annotations: { destructiveHint: true },
      });
    } finally {
      session.close();
    }
  });

  it("calls log__bottle through MCP and returns schema-valid structured content", async () => {
    const activity = loggedBottleActivity();
    const logBottle = vi.fn(async () => activity);
    const server = createMCPServer(babyDaybookCommands, {
      name: "baby-daybook-test",
      version: "0.1.0",
      omitRootToolNamePrefix: true,
      services: { babyDaybook: commandService({
        listBabies: vi.fn(async () => [{ uid: "baby", name: "Michael" }]),
        baby: vi.fn(() => ({
          listGroups: vi.fn(async () => [{ uid: "formula", userUid: "user", babyUid: "baby", daType: "bottle", title: "Formula" }]),
          getLastActivity: vi.fn(async () => ({ groupUid: "formula" })),
          logBottle,
        })),
      }) },
    });
    const session = server.createMessageSession(() => undefined);
    try {
      await session.handleMessage("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      });
      const response = await session.handleMessage("tools/call", {
        name: "log__bottle",
        arguments: { volume: 150, volume_unit: "milliliters" },
      }) as any;
      const expected = { activity: wireLoggedBottleActivity(activity) };

      expect(response.result.structuredContent).toEqual(expected);
      expect(response.result.content).toEqual([{ type: "text", text: JSON.stringify(expected) }]);
      expect(logBottle).toHaveBeenCalledWith(expect.objectContaining({ volume: 150, groupUid: "formula" }));
    } finally {
      session.close();
    }
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

const CANONICAL_COMMAND_PATHS = [
  "log.pump", "log.bottle", "log.diaper", "log.medicine", "log.activity",
  "timeline.recent", "timeline.active", "timeline.list", "timeline.search", "timeline.delete",
  "timeline.timer.start", "timeline.timer.stop", "timeline.timer.pause", "timeline.timer.resume",
  "babies.list", "babies.get",
  "sleep.predict", "sleep.recommendation", "sleep.schedule", "sleep.statistics",
  "journal.growth.list", "journal.growth.add", "journal.growth.delete",
  "journal.moments.list", "journal.moments.add", "journal.moments.delete",
  "journal.notes.get", "journal.notes.set", "journal.notes.search", "journal.notes.delete",
  "journal.teeth.list", "journal.teeth.set", "journal.teeth.delete",
  "reminders.list", "reminders.add", "reminders.dismiss", "reminders.delete",
  "insights.overview", "insights.activities",
  "manage.account.status", "manage.account.set-display-name", "manage.account.send-email-verification", "manage.account.delete",
  "manage.babies.create", "manage.babies.update", "manage.babies.delete",
  "manage.activity-types.list", "manage.activity-types.create", "manage.activity-types.update", "manage.activity-types.delete",
  "manage.activity-groups.list", "manage.activity-groups.create", "manage.activity-groups.update", "manage.activity-groups.delete",
  "manage.settings.get", "manage.settings.set",
  "manage.caregivers.list", "manage.caregivers.invite", "manage.caregivers.cancel-invite", "manage.caregivers.remove",
  "manage.caregivers.transfer-primary", "manage.caregivers.accept", "manage.caregivers.decline", "manage.caregivers.leave",
  "reports.activities-csv", "reports.activities-pdf", "reports.growth-pdf", "reports.timeline-pdf",
  "advanced.raw.activities.update", "advanced.raw.growth.update", "advanced.raw.moments.update", "advanced.raw.reminders.update",
  "advanced.attachments.list", "advanced.attachments.upload", "advanced.attachments.download", "advanced.attachments.delete",
  "advanced.backup.create", "advanced.backup.restore", "advanced.sync.snapshot",
] as const;

function commandNodes(root: any, path: string[] = []): Array<any> {
  if (root.kind === "command") return [{ ...root, commandPath: [...path, root.name] }];
  const nextPath = root.name === "baby-daybook" ? path : [...path, root.name];
  return root.children.flatMap((child: any) => commandNodes(child, nextPath));
}

function findCommand(commands: Array<any>, ...path: string[]): any {
  const command = commands.find((candidate) => candidate.commandPath.join(".") === path.join("."));
  if (!command) throw new Error(`Missing command ${path.join(".")}`);
  return command;
}

function loggedBottleActivity() {
  return {
    uid: "logged",
    userUid: "user",
    babyUid: "baby",
    type: "bottle",
    startMillis: 100,
    updatedMillis: 101,
    rev: 4,
    groupUid: "formula",
    notes: "",
    inProgress: false,
    endMillis: 0,
    duration: 0,
    pauseMillis: 0,
    leftDuration: 0,
    rightDuration: 0,
    side: "",
    reaction: "",
    amount: 0,
    amountUnit: "",
    temperature: 0,
    hairWash: false,
    volume: 150,
    pee: false,
    poo: false,
  };
}

function wireLoggedBottleActivity(activity: ReturnType<typeof loggedBottleActivity>) {
  return {
    uid: activity.uid,
    user_uid: activity.userUid,
    baby_uid: activity.babyUid,
    type: activity.type,
    start_millis: activity.startMillis,
    updated_millis: activity.updatedMillis,
    rev: activity.rev,
    group_uid: activity.groupUid,
    notes: activity.notes,
    in_progress: activity.inProgress,
    end_millis: activity.endMillis,
    duration: activity.duration,
    pause_millis: activity.pauseMillis,
    left_duration: activity.leftDuration,
    right_duration: activity.rightDuration,
    side: activity.side,
    reaction: activity.reaction,
    amount: activity.amount,
    amount_unit: activity.amountUnit,
    temperature: activity.temperature,
    hair_wash: activity.hairWash,
    volume: activity.volume,
    pee: activity.pee,
    poo: activity.poo,
  };
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
    baby: "baby",
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
    volumeUnit: "milliliters",
    backupJson: "{}",
    dataBase64: "YQ==",
    fileName: "00000000-0000-4000-8000-000000000000.jpg",
    contentType: "image/jpeg",
    contents: "wet",
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
  const record = { uid: "record", userUid: "user", babyUid: "baby", name: "Baby", title: "Title", type: "sleeping", dateMillis: 100, hasDuration: true };
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
    listGroups: vi.fn(async (type: string) => [{ uid: "value", userUid: "user", babyUid: "baby", daType: type, title: "value" }]),
    getLastActivity: vi.fn(async () => ({ groupUid: "value" })),
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
    listBabies: vi.fn(async () => [{ uid: "baby", userUid: "user", name: "Baby" }]),
    getBaby: vi.fn(async () => record),
  }, {
    get(target, property, receiver) {
      if (property === "then") return undefined;
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      return vi.fn(async (...args: unknown[]) => args[0] && typeof args[0] === "object" ? args[0] : record);
    },
  });
}
