import { defineCommand, defineGroup, S, UserError } from "toolcraft";
import type { Command, Group, HandlerContext, ObjectSchema, Static, ToolAnnotations } from "toolcraft";
import { withActivityTypeDisplayTitle } from "./activity-types.js";
import type { BabyClient, BabyDaybookClient } from "./client.js";
import type { BabyDaybookCommandServices } from "./command-service.js";
import { isNativeTrue } from "./native-flags.js";
import { convertValueToMetric } from "./units.js";
import type {
  ActivityGroup,
  ActivityType,
  Baby,
  DailyAction,
  GrowthEntry,
  LoggedActivity,
  Moment,
  Reminder,
  Tooth,
} from "./types.js";

const MAX_TEXT = 16_384;
const MAX_JSON = 16 * 1024 * 1024;
const babyUid = S.String({ description: "Baby UID", minLength: 1, maxLength: 256 });
const uid = S.String({ description: "Record UID", minLength: 1, maxLength: 256 });
const optionalMillis = S.Optional(S.Number({ description: "Unix timestamp in milliseconds" }));
const includeDeleted = S.Optional(S.Boolean({ description: "Include synchronization tombstones", default: false }));
const dataResult = S.Object({ data: S.Json() });
const okResult = S.Object({ ok: S.Boolean() });
const selectedBaby = S.Optional(S.String({ description: "Baby UID or exact name; omit when the account has exactly one baby", minLength: 1, maxLength: 256 }));
const volumeUnit = S.Optional(S.Enum(["milliliters", "fluidOunces"] as const, { default: "milliliters" }));
const loggedActivityResult = S.Object({
  activity: S.Object({
    uid: S.String(),
    userUid: S.String(),
    babyUid: S.String(),
    type: S.String(),
    startMillis: S.Number(),
    updatedMillis: S.Number(),
    rev: S.Number(),
    groupUid: S.String(),
    notes: S.String(),
    inProgress: S.Boolean(),
    endMillis: S.Number(),
    duration: S.Number(),
    pauseMillis: S.Number(),
    leftDuration: S.Number(),
    rightDuration: S.Number(),
    side: S.String(),
    reaction: S.String(),
    amount: S.Number(),
    amountUnit: S.String(),
    temperature: S.Number(),
    hairWash: S.Boolean(),
    volume: S.Number(),
    pee: S.Boolean(),
    poo: S.Boolean(),
    svt: S.Optional(S.Number()),
  }),
});
type LoggedActivityResult = Static<typeof loggedActivityResult>;

type Services = BabyDaybookCommandServices;
type DataContext<TParams extends ObjectSchema<any>> = HandlerContext<TParams, undefined, Services>;
type CommandEffect = "read" | "create" | "update" | "delete";

type DataCommandConfig<TName extends string, TParams extends ObjectSchema<any>> = {
  name: TName;
  description: string;
  params: TParams;
  positional?: string[];
  confirm?: boolean;
  examples?: Array<{ title: string; params: Record<string, unknown> }>;
  openWorld?: boolean;
  handler: (context: DataContext<TParams>) => unknown | Promise<unknown>;
};

function dataCommand<const TName extends string, TParams extends ObjectSchema<any>>(
  config: DataCommandConfig<TName, TParams>,
  effect: CommandEffect,
) {
  const { openWorld = false, ...commandConfig } = config;
  return defineCommand<Services, TName, TParams, undefined, { data: Static<ReturnType<typeof S.Json>> }>({
    ...commandConfig,
    title: config.description,
    annotations: effectAnnotations(effect, openWorld),
    result: dataResult,
    handler: async (context) => ({ data: toJsonValue(await config.handler(context as DataContext<TParams>)) }),
  });
}

function readCommand<const TName extends string, TParams extends ObjectSchema<any>>(config: DataCommandConfig<TName, TParams>) {
  return dataCommand(config, "read");
}

function createCommand<const TName extends string, TParams extends ObjectSchema<any>>(config: DataCommandConfig<TName, TParams>) {
  return dataCommand(config, "create");
}

function updateCommand<const TName extends string, TParams extends ObjectSchema<any>>(config: DataCommandConfig<TName, TParams>) {
  return dataCommand(config, "update");
}

function deleteCommand<const TName extends string, TParams extends ObjectSchema<any>>(config: DataCommandConfig<TName, TParams>) {
  return dataCommand(config, "delete");
}

type OkCommandConfig<TName extends string, TParams extends ObjectSchema<any>> = {
  name: TName;
  description: string;
  params: TParams;
  positional?: string[];
  confirm?: boolean;
  examples?: Array<{ title: string; params: Record<string, unknown> }>;
  openWorld?: boolean;
  handler: (context: DataContext<TParams>) => unknown | Promise<unknown>;
};

function okCommand<const TName extends string, TParams extends ObjectSchema<any>>(
  config: OkCommandConfig<TName, TParams>,
  effect: CommandEffect,
) {
  const { openWorld = false, ...commandConfig } = config;
  return defineCommand<Services, TName, TParams, undefined, { ok: boolean }>({
    ...commandConfig,
    title: config.description,
    annotations: effectAnnotations(effect, openWorld),
    result: okResult,
    handler: async (context) => {
      await config.handler(context as DataContext<TParams>);
      return { ok: true };
    },
  });
}

function createOkCommand<const TName extends string, TParams extends ObjectSchema<any>>(config: OkCommandConfig<TName, TParams>) {
  return okCommand(config, "create");
}

function updateOkCommand<const TName extends string, TParams extends ObjectSchema<any>>(config: OkCommandConfig<TName, TParams>) {
  return okCommand(config, "update");
}

function deleteOkCommand<const TName extends string, TParams extends ObjectSchema<any>>(config: OkCommandConfig<TName, TParams>) {
  return okCommand(config, "delete");
}

async function withClient<T>(context: DataContext<any>, operation: (client: BabyDaybookClient) => Promise<T>): Promise<T> {
  const { client } = await context.babyDaybook.connect(context.secrets as Record<string, unknown>, context.env);
  return operation(client);
}

async function withBaby<T>(context: DataContext<any>, operation: (baby: BabyClient) => Promise<T>): Promise<T> {
  const selectedBabyUid = String((context.params as { babyUid: string }).babyUid);
  return withClient(context, (client) => operation(client.baby(selectedBabyUid)));
}

async function withSelectedBaby<T>(
  context: DataContext<any>,
  reference: string | undefined,
  operation: (baby: BabyClient) => Promise<T>,
): Promise<T> {
  return withClient(context, async (client) => operation(client.baby(await resolveBabyUid(client, reference))));
}

function loggedActivityCommand<const TName extends string, TParams extends ObjectSchema<any>>(config: {
  name: TName;
  title: string;
  description: string;
  params: TParams;
  positional?: string[];
  examples?: Array<{ title: string; params: Record<string, unknown> }>;
  handler: (context: DataContext<TParams>) => Promise<LoggedActivity>;
}) {
  return defineCommand<Services, TName, TParams, undefined, LoggedActivityResult>({
    ...config,
    annotations: effectAnnotations("create", false),
    result: loggedActivityResult,
    handler: async (context) => ({ activity: await config.handler(context as DataContext<TParams>) }),
  });
}

const sessionStatus = readCommand({
  name: "status",
  description: "Validate authentication and summarize the active account",
  params: S.Object({}),
  handler: (context) => withClient(context, async (client) => {
    const [account, user, babies] = await Promise.all([
      client.auth.getAccount(client.session),
      client.getUser(),
      client.listBabies(),
    ]);
    return {
      authenticated: true,
      displayName: user?.displayName ?? account.displayName,
      hasEmail: Boolean(account.email),
      emailVerified: account.emailVerified ?? false,
      providers: account.providerUserInfo?.map((provider) => provider.providerId) ?? [],
      babyCount: babies.length,
    };
  }),
});

const accountUpdateDisplayName = updateCommand({
  name: "set-display-name",
  description: "Update the account display name",
  params: S.Object({ displayName: S.String({ minLength: 1, maxLength: 256 }) }),
  handler: (context) => withClient(context, (client) => client.updateDisplayName(context.params.displayName)),
});

const accountSendVerification = createOkCommand({
  name: "send-email-verification",
  description: "Send an email verification message",
  openWorld: true,
  params: S.Object({}),
  handler: (context) => withClient(context, (client) => client.sendEmailVerification()),
});

const accountDelete = deleteOkCommand({
  name: "delete",
  description: "Permanently delete the Baby Daybook account",
  params: S.Object({}),
  confirm: true,
  handler: (context) => withClient(context, (client) => client.deleteAccount()),
});

const babiesList = readCommand({
  name: "list",
  description: "List accessible babies",
  params: S.Object({ includeDeleted }),
  handler: (context) => withClient(context, (client) => client.listBabies({ includeDeleted: context.params.includeDeleted })),
});

const babiesGet = readCommand({
  name: "get",
  description: "Get a baby profile",
  positional: ["babyUid"],
  params: S.Object({ babyUid }),
  handler: (context) => withClient(context, (client) => client.getBaby(context.params.babyUid)),
});

const babiesCreate = createCommand({
  name: "create",
  description: "Create a baby with native default activity types and groups",
  params: S.Object({
    name: S.String({ minLength: 1, maxLength: 256 }),
    gender: S.Optional(S.String({ maxLength: 64 })),
    birthdayMillis: optionalMillis,
    expectedBirthdayMillis: optionalMillis,
    premature: S.Optional(S.Boolean()),
    sleepPredictionEnabled: S.Optional(S.Boolean()),
  }),
  handler: (context) => withClient(context, (client) => client.createBaby({
    name: context.params.name,
    gender: context.params.gender,
    birthdayMillis: context.params.birthdayMillis,
    expectedBirthdayMillis: context.params.expectedBirthdayMillis,
    isPremature: context.params.premature,
    sleepPredictionEnabled: context.params.sleepPredictionEnabled,
  })),
});

const babiesUpdate = updateCommand({
  name: "update",
  description: "Update baby profile fields from a JSON object",
  positional: ["babyUid"],
  params: S.Object({
    babyUid,
    patchJson: S.String({ description: "JSON object of Baby fields", minLength: 2, maxLength: MAX_JSON }),
  }),
  handler: (context) => withBaby(context, (baby) => baby.save(parseObject(context.params.patchJson, "patchJson") as Partial<Baby>)),
});

const babiesDelete = deleteCommand({
  name: "delete",
  description: "Delete a baby using the native synchronization tombstone",
  positional: ["babyUid"],
  params: S.Object({ babyUid }),
  confirm: true,
  handler: (context) => withBaby(context, (baby) => baby.softDelete()),
});

const logPump = loggedActivityCommand({
  name: "pump",
  title: "Log pumping",
  description: "Log a completed pumping session in milliliters or fluid ounces",
  positional: ["volume"],
  params: S.Object({
    baby: selectedBaby,
    volume: S.Number({ description: "Expressed milk volume", minimum: Number.MIN_VALUE, maximum: 5_000 }),
    volumeUnit,
    side: S.Enum(["left", "right", "both"] as const),
    atMillis: optionalMillis,
    notes: S.Optional(S.String({ maxLength: MAX_TEXT })),
  }),
  handler: (context) => withSelectedBaby(context, context.params.baby, (baby) => baby.logPump({
    volume: canonicalVolume(context.params.volume, context.params.volumeUnit),
    side: context.params.side,
    startMillis: context.params.atMillis,
    notes: context.params.notes,
  })),
});

const logBottle = loggedActivityCommand({
  name: "bottle",
  title: "Log a bottle",
  description: "Log a completed bottle feed, reusing the last feed group when unambiguous",
  positional: ["volume"],
  params: S.Object({
    baby: selectedBaby,
    volume: S.Number({ description: "Bottle volume", minimum: Number.MIN_VALUE, maximum: 5_000 }),
    volumeUnit,
    feed: S.Optional(S.String({ description: "Bottle feed group UID or exact title", minLength: 1, maxLength: 256 })),
    atMillis: optionalMillis,
    notes: S.Optional(S.String({ maxLength: MAX_TEXT })),
  }),
  handler: (context) => withSelectedBaby(context, context.params.baby, async (baby) => baby.logBottle({
    volume: canonicalVolume(context.params.volume, context.params.volumeUnit),
    groupUid: await resolveActivityGroupUid(baby, "bottle", context.params.feed, true),
    startMillis: context.params.atMillis,
    notes: context.params.notes,
  })),
});

const logDiaper = loggedActivityCommand({
  name: "diaper",
  title: "Log a diaper change",
  description: "Log a completed wet, dirty, wet-and-dirty, or dry diaper change",
  positional: ["contents"],
  params: S.Object({
    baby: selectedBaby,
    contents: S.Enum(["wet", "dirty", "wet-and-dirty", "dry"] as const),
    atMillis: optionalMillis,
    notes: S.Optional(S.String({ maxLength: MAX_TEXT })),
  }),
  handler: (context) => withSelectedBaby(context, context.params.baby, (baby) => baby.logDiaper({
    pee: context.params.contents === "wet" || context.params.contents === "wet-and-dirty",
    poo: context.params.contents === "dirty" || context.params.contents === "wet-and-dirty",
    startMillis: context.params.atMillis,
    notes: context.params.notes,
  })),
});

const logMedicine = loggedActivityCommand({
  name: "medicine",
  title: "Log medicine",
  description: "Log a completed medicine dose using a configured medicine group",
  positional: ["medicine", "amount", "unit"],
  params: S.Object({
    baby: selectedBaby,
    medicine: S.String({ description: "Medicine group UID or exact title", minLength: 1, maxLength: 256 }),
    amount: S.Number({ minimum: Number.MIN_VALUE }),
    unit: S.String({ description: "Dose unit such as drops, ml, or tablet", minLength: 1, maxLength: 128 }),
    atMillis: optionalMillis,
    notes: S.Optional(S.String({ maxLength: MAX_TEXT })),
  }),
  handler: (context) => withSelectedBaby(context, context.params.baby, async (baby) => baby.logMedicine({
    groupUid: await resolveActivityGroupUid(baby, "medicine", context.params.medicine, false),
    amount: context.params.amount,
    amountUnit: context.params.unit,
    startMillis: context.params.atMillis,
    notes: context.params.notes,
  })),
});

const logActivity = loggedActivityCommand({
  name: "activity",
  title: "Log another activity",
  description: "Log any configured non-timer activity with typed optional fields",
  positional: ["type"],
  params: S.Object({
    baby: selectedBaby,
    type: S.String({ minLength: 1, maxLength: 256 }),
    atMillis: optionalMillis,
    notes: S.Optional(S.String({ maxLength: MAX_TEXT })),
    group: S.Optional(S.String({ description: "Activity group UID or exact title", minLength: 1, maxLength: 256 })),
    side: S.Optional(S.Enum(["left", "right", "both"] as const)),
    volume: S.Optional(S.Number({ minimum: Number.MIN_VALUE, maximum: 5_000 })),
    volumeUnit,
    amount: S.Optional(S.Number({ minimum: 0 })),
    amountUnit: S.Optional(S.String({ minLength: 1, maxLength: 128 })),
    temperature: S.Optional(S.Number()),
    reaction: S.Optional(S.Enum(["liked", "neutral", "disliked"] as const)),
    pee: S.Optional(S.Boolean()),
    poo: S.Optional(S.Boolean()),
    hairWash: S.Optional(S.Boolean()),
  }),
  handler: (context) => withSelectedBaby(context, context.params.baby, async (baby) => {
    if ((context.params.amount === undefined) !== (context.params.amountUnit === undefined)) {
      throw new UserError("--amount and --amount-unit must be provided together");
    }
    return baby.logActivity({
      type: context.params.type,
      startMillis: context.params.atMillis,
      notes: context.params.notes,
      groupUid: context.params.group === undefined
        ? undefined
        : await resolveActivityGroupUid(baby, context.params.type, context.params.group, false),
      side: context.params.side,
      volume: context.params.volume === undefined
        ? undefined
        : canonicalVolume(context.params.volume, context.params.volumeUnit),
      amount: context.params.amount,
      amountUnit: context.params.amountUnit,
      temperature: context.params.temperature,
      reaction: context.params.reaction,
      pee: context.params.pee,
      poo: context.params.poo,
      hairWash: context.params.hairWash,
    });
  }),
});

const activitiesList = readCommand({
  name: "list",
  description: "List activities, optionally within a time range",
  positional: ["babyUid"],
  params: S.Object({ babyUid, fromMillis: optionalMillis, toMillis: optionalMillis, includeDeleted }),
  handler: (context) => withBaby(context, async (baby) => context.params.fromMillis !== undefined && context.params.toMillis !== undefined
    ? baby.listActivitiesForRange({ fromMillis: context.params.fromMillis, toMillis: context.params.toMillis, includeDeleted: context.params.includeDeleted })
    : baby.activities.list({ includeDeleted: context.params.includeDeleted })),
});

const activitiesRecent = readCommand({
  name: "recent",
  description: "List the most recent activities without requiring a baby UID when only one baby is available",
  params: S.Object({ baby: selectedBaby, type: S.Optional(S.String({ maxLength: 256 })), limit: S.Optional(S.Number({ minimum: 1, maximum: 100, default: 20 })) }),
  handler: (context) => withSelectedBaby(context, context.params.baby, (baby) => baby.searchActivities({
    types: context.params.type ? [context.params.type] : undefined,
    limit: context.params.limit,
  })),
});

const activitiesActive = readCommand({
  name: "active",
  description: "List currently running activity timers",
  params: S.Object({ baby: selectedBaby, type: S.Optional(S.String({ maxLength: 256 })) }),
  handler: (context) => withSelectedBaby(context, context.params.baby, (baby) => baby.getInProgressActivities(context.params.type ? [context.params.type] : undefined)),
});

const activitiesStart = createCommand({
  name: "start",
  description: "Start a timed activity",
  positional: ["babyUid", "type"],
  params: S.Object({
    babyUid,
    type: S.String({ minLength: 1, maxLength: 256 }),
    startMillis: optionalMillis,
    notes: S.Optional(S.String({ maxLength: MAX_TEXT })),
    groupUid: S.Optional(S.String({ maxLength: 256 })),
    side: S.Optional(S.Enum(["left", "right", "both"] as const)),
    volume: S.Optional(S.Number()),
    amount: S.Optional(S.Number()),
    amountUnit: S.Optional(S.String({ maxLength: 128 })),
    temperature: S.Optional(S.Number()),
    reaction: S.Optional(S.Enum(["liked", "neutral", "disliked"] as const)),
    pee: S.Optional(S.Boolean()),
    poo: S.Optional(S.Boolean()),
  }),
  handler: (context) => withBaby(context, async (baby) => {
    const activityType = await baby.activityTypes.get(context.params.type);
    if (!activityType || activityType.deleted) throw new UserError(`Activity type ${context.params.type} does not exist`);
    if (!isNativeTrue(activityType.hasDuration)) throw new UserError(`Activity type ${context.params.type} is not timed; use log activity instead`);
    return baby.startActivity({
      type: context.params.type,
      startMillis: context.params.startMillis,
      notes: context.params.notes,
      groupUid: context.params.groupUid,
      side: context.params.side,
      volume: context.params.volume,
      amount: context.params.amount,
      amountUnit: context.params.amountUnit,
      temperature: context.params.temperature,
      reaction: context.params.reaction,
      pee: context.params.pee,
      poo: context.params.poo,
    });
  }),
});

const activityUidParams = S.Object({ babyUid, uid });
const activitiesStop = updateCommand({ name: "stop", description: "Stop an in-progress activity", positional: ["babyUid", "uid"], params: S.Object({ babyUid, uid, atMillis: optionalMillis }), handler: (context) => withBaby(context, (baby) => baby.stopActivity(context.params.uid, context.params.atMillis)) });
const activitiesPause = updateCommand({ name: "pause", description: "Pause an in-progress activity", positional: ["babyUid", "uid"], params: S.Object({ babyUid, uid, atMillis: optionalMillis }), handler: (context) => withBaby(context, (baby) => baby.pauseActivity(context.params.uid, context.params.atMillis)) });
const activitiesResume = updateCommand({ name: "resume", description: "Resume a paused activity", positional: ["babyUid", "uid"], params: S.Object({ babyUid, uid, atMillis: optionalMillis }), handler: (context) => withBaby(context, (baby) => baby.resumeActivity(context.params.uid, context.params.atMillis)) });
const activitiesDelete = deleteCommand({ name: "delete", description: "Delete an activity", positional: ["babyUid", "uid"], params: activityUidParams, confirm: true, handler: (context) => withBaby(context, (baby) => baby.deleteActivity(context.params.uid)) });
const activitiesUpdate = updateCommand({
  name: "update",
  description: "Update an activity from a JSON object",
  positional: ["babyUid", "uid"],
  params: S.Object({ babyUid, uid, patchJson: S.String({ minLength: 2, maxLength: MAX_JSON }) }),
  handler: (context) => withBaby(context, async (baby) => {
    const current = await baby.activities.get(context.params.uid);
    if (!current) throw new Error(`Activity ${context.params.uid} does not exist`);
    return baby.saveActivity({ ...current, ...parseObject(context.params.patchJson, "patchJson"), uid: current.uid } as DailyAction);
  }),
});

const activityTypesList = readCommand({ name: "list", description: "List activity types", positional: ["babyUid"], params: S.Object({ babyUid, includeDeleted }), handler: (context) => withBaby(context, async (baby) => (await baby.activityTypes.list({ includeDeleted: context.params.includeDeleted })).map(withActivityTypeDisplayTitle)) });
const activityTypesCreate = createCommand({
  name: "create",
  description: "Create a custom activity type",
  positional: ["babyUid", "title"],
  params: S.Object({ babyUid, title: S.String({ minLength: 1, maxLength: 256 }), icon: S.Optional(S.String({ maxLength: 128 })), color: S.Optional(S.String({ maxLength: 64 })), hasDuration: S.Optional(S.Boolean()), hasAmount: S.Optional(S.Boolean()), hasReaction: S.Optional(S.Boolean()) }),
  handler: (context) => withBaby(context, (baby) => baby.createActivityType({ title: context.params.title, icon: context.params.icon, color: context.params.color, hasDuration: context.params.hasDuration, hasAmount: context.params.hasAmount, hasReaction: context.params.hasReaction })),
});
const activityTypesUpdate = updateCommand({ name: "update", description: "Update an activity type from JSON", positional: ["babyUid", "uid"], params: S.Object({ babyUid, uid, patchJson: S.String({ minLength: 2, maxLength: MAX_JSON }) }), handler: (context) => withBaby(context, async (baby) => { const current = await baby.activityTypes.get(context.params.uid); if (!current) throw new Error(`Activity type ${context.params.uid} does not exist`); return baby.saveActivityType({ ...current, ...parseObject(context.params.patchJson, "patchJson"), uid: current.uid } as ActivityType); }) });
const activityTypesDelete = deleteOkCommand({ name: "delete", description: "Delete a custom activity type and its dependent records", positional: ["babyUid", "uid"], params: activityUidParams, confirm: true, handler: (context) => withBaby(context, (baby) => baby.deleteActivityType(context.params.uid)) });

const groupsList = readCommand({ name: "list", description: "List activity groups", positional: ["babyUid"], params: S.Object({ babyUid, type: S.Optional(S.String({ maxLength: 256 })) }), handler: (context) => withBaby(context, (baby) => baby.listGroups(context.params.type)) });
const groupsCreate = createCommand({ name: "create", description: "Create an activity group", positional: ["babyUid", "type", "title"], params: S.Object({ babyUid, type: S.String({ minLength: 1, maxLength: 256 }), title: S.String({ minLength: 1, maxLength: 256 }), description: S.Optional(S.String({ maxLength: MAX_TEXT })) }), handler: (context) => withBaby(context, (baby) => baby.createGroup({ daType: context.params.type, title: context.params.title, description: context.params.description })) });
const groupsUpdate = updateCommand({ name: "update", description: "Update an activity group from JSON", positional: ["babyUid", "uid"], params: S.Object({ babyUid, uid, patchJson: S.String({ minLength: 2, maxLength: MAX_JSON }) }), handler: (context) => withBaby(context, async (baby) => { const current = await baby.groups.get(context.params.uid); if (!current) throw new Error(`Group ${context.params.uid} does not exist`); return baby.saveGroup({ ...current, ...parseObject(context.params.patchJson, "patchJson"), uid: current.uid } as ActivityGroup); }) });
const groupsDelete = deleteOkCommand({ name: "delete", description: "Delete an activity group", positional: ["babyUid", "uid"], params: activityUidParams, confirm: true, handler: (context) => withBaby(context, (baby) => baby.deleteGroup(context.params.uid)) });

const growthList = readCommand({ name: "list", description: "List growth entries", positional: ["babyUid"], params: S.Object({ babyUid, includeDeleted }), handler: (context) => withBaby(context, (baby) => baby.listGrowth({ includeDeleted: context.params.includeDeleted })) });
const growthAdd = createCommand({ name: "add", description: "Add a growth measurement", positional: ["babyUid"], params: S.Object({ babyUid, dateMillis: optionalMillis, weight: S.Optional(S.Number()), height: S.Optional(S.Number()), headSize: S.Optional(S.Number()), notes: S.Optional(S.String({ maxLength: MAX_TEXT })) }), handler: (context) => withBaby(context, (baby) => baby.createGrowth({ dateMillis: context.params.dateMillis, weight: context.params.weight, height: context.params.height, headSize: context.params.headSize, notes: context.params.notes }, context.params.dateMillis)) });
const growthUpdate = updateCommand({ name: "update", description: "Update a growth entry from JSON", positional: ["babyUid", "uid"], params: S.Object({ babyUid, uid, patchJson: S.String({ minLength: 2, maxLength: MAX_JSON }) }), handler: (context) => withBaby(context, async (baby) => { const current = await baby.growth.get(context.params.uid); if (!current) throw new Error(`Growth entry ${context.params.uid} does not exist`); return baby.saveGrowth({ ...current, ...parseObject(context.params.patchJson, "patchJson"), uid: current.uid } as GrowthEntry); }) });
const growthDelete = deleteCommand({ name: "delete", description: "Delete a growth entry", positional: ["babyUid", "uid"], params: activityUidParams, confirm: true, handler: (context) => withBaby(context, (baby) => baby.deleteGrowth(context.params.uid)) });

const momentsList = readCommand({ name: "list", description: "List moments", positional: ["babyUid"], params: S.Object({ babyUid, includeDeleted }), handler: (context) => withBaby(context, (baby) => baby.moments.list({ includeDeleted: context.params.includeDeleted })) });
const momentsAdd = createCommand({ name: "add", description: "Add a development moment", positional: ["babyUid"], params: S.Object({ babyUid, dateMillis: optionalMillis, description: S.Optional(S.String({ maxLength: MAX_TEXT })) }), handler: (context) => withBaby(context, (baby) => baby.createMoment({ dateMillis: context.params.dateMillis, description: context.params.description }, context.params.dateMillis)) });
const momentsUpdate = updateCommand({ name: "update", description: "Update a moment from JSON", positional: ["babyUid", "uid"], params: S.Object({ babyUid, uid, patchJson: S.String({ minLength: 2, maxLength: MAX_JSON }) }), handler: (context) => withBaby(context, async (baby) => { const current = await baby.moments.get(context.params.uid); if (!current) throw new Error(`Moment ${context.params.uid} does not exist`); return baby.saveMoment({ ...current, ...parseObject(context.params.patchJson, "patchJson"), uid: current.uid } as Moment); }) });
const momentsDelete = deleteCommand({ name: "delete", description: "Delete a moment", positional: ["babyUid", "uid"], params: activityUidParams, confirm: true, handler: (context) => withBaby(context, (baby) => baby.deleteMoment(context.params.uid)) });

const notesGet = readCommand({ name: "get", description: "Get the daily note for a date", positional: ["babyUid"], params: S.Object({ babyUid, atMillis: optionalMillis, timeZone: S.Optional(S.String({ maxLength: 128 })) }), handler: (context) => withBaby(context, (baby) => baby.getDailyNote(context.params.atMillis, context.params.timeZone)) });
const notesSet = updateCommand({ name: "set", description: "Set the daily note for a date", positional: ["babyUid", "note"], params: S.Object({ babyUid, note: S.String({ maxLength: MAX_TEXT }), atMillis: optionalMillis, timeZone: S.Optional(S.String({ maxLength: 128 })) }), handler: (context) => withBaby(context, (baby) => baby.setDailyNote(context.params.note, context.params.atMillis, context.params.timeZone)) });
const notesDelete = deleteOkCommand({ name: "delete", description: "Delete the daily note for a date", positional: ["babyUid"], params: S.Object({ babyUid, atMillis: optionalMillis, timeZone: S.Optional(S.String({ maxLength: 128 })) }), confirm: true, handler: (context) => withBaby(context, (baby) => baby.deleteDailyNote(context.params.atMillis, context.params.timeZone)) });

const teethList = readCommand({ name: "list", description: "List the native primary-tooth map", positional: ["babyUid"], params: S.Object({ babyUid, includeDeleted }), handler: (context) => withBaby(context, (baby) => baby.getToothMap({ includeDeleted: context.params.includeDeleted })) });
const teethSet = updateCommand({ name: "set", description: "Create or update a tooth state", positional: ["babyUid", "name", "jaw", "side"], params: S.Object({ babyUid, name: S.String({ minLength: 1, maxLength: 64 }), jaw: S.Enum(["upper", "lower"] as const), side: S.Enum(["left", "right"] as const), erupted: S.Optional(S.Boolean()), eruptedMillis: optionalMillis, shed: S.Optional(S.Boolean()), shedMillis: optionalMillis, notes: S.Optional(S.String({ maxLength: MAX_TEXT })) }), handler: (context) => withBaby(context, async (baby) => { const created = await baby.createTooth({ name: context.params.name as Tooth["name"], jaw: context.params.jaw, side: context.params.side, notes: context.params.notes }); return baby.saveTooth({ ...created, erupted: context.params.erupted, eruptedMillis: context.params.eruptedMillis, shed: context.params.shed, shedMillis: context.params.shedMillis } as Tooth); }) });
const teethDelete = deleteCommand({ name: "delete", description: "Delete a tooth record", positional: ["babyUid", "uid"], params: activityUidParams, confirm: true, handler: (context) => withBaby(context, (baby) => baby.deleteTooth(context.params.uid)) });

const remindersList = readCommand({ name: "list", description: "List reminder schedules", positional: ["babyUid"], params: S.Object({ babyUid, includeDeleted }), handler: (context) => withBaby(context, (baby) => baby.getReminderSchedules({ includeDeleted: context.params.includeDeleted })) });
const remindersAdd = createCommand({ name: "add", description: "Create a reminder", positional: ["babyUid", "type"], params: S.Object({ babyUid, type: S.String({ minLength: 1, maxLength: 256 }), reminderType: S.Optional(S.Enum(["basic", "advanced", "advanced_repeat_days", "advanced_repeat_weekdays"] as const)), dateMillis: optionalMillis, groupUid: S.Optional(S.String({ maxLength: 256 })), intervalMillis: S.Optional(S.Number()), repeatDays: S.Optional(S.Number()), repeatWeekdays: S.Optional(S.String({ maxLength: 64 })), dndFrom: S.Optional(S.String({ maxLength: 16 })), dndTo: S.Optional(S.String({ maxLength: 16 })) }), handler: (context) => withBaby(context, (baby) => baby.createReminder({ daType: context.params.type, type: context.params.reminderType, dateMillis: context.params.dateMillis, groupUid: context.params.groupUid, intervalMillis: context.params.intervalMillis, repeatDays: context.params.repeatDays, repeatWeekdays: context.params.repeatWeekdays, dndFrom: context.params.dndFrom, dndTo: context.params.dndTo }, context.params.dateMillis)) });
const remindersUpdate = updateCommand({ name: "update", description: "Update a reminder from JSON", positional: ["babyUid", "uid"], params: S.Object({ babyUid, uid, patchJson: S.String({ minLength: 2, maxLength: MAX_JSON }) }), handler: (context) => withBaby(context, async (baby) => { const current = await baby.reminders.get(context.params.uid); if (!current) throw new Error(`Reminder ${context.params.uid} does not exist`); return baby.saveReminder({ ...current, ...parseObject(context.params.patchJson, "patchJson"), uid: current.uid } as Reminder); }) });
const remindersDismiss = updateCommand({ name: "dismiss", description: "Dismiss a reminder", positional: ["babyUid", "uid"], params: activityUidParams, handler: (context) => withBaby(context, (baby) => baby.dismissReminder(context.params.uid)) });
const remindersDelete = deleteCommand({ name: "delete", description: "Delete a reminder", positional: ["babyUid", "uid"], params: activityUidParams, confirm: true, handler: (context) => withBaby(context, (baby) => baby.deleteReminder(context.params.uid)) });

const settingsGet = readCommand({ name: "get", description: "Get normalized per-baby settings", positional: ["babyUid"], params: S.Object({ babyUid }), handler: (context) => withBaby(context, async (baby) => ({ daytimeRange: await baby.getDaytimeRange(), notificationsEnabled: await baby.areNotificationsEnabled(), quickAddNotificationEnabled: await baby.isQuickAddNotificationEnabled(), stickyNotifications: await baby.listStickyNotifications(), sleepPredictionNotificationMinutes: await baby.getSleepPredictionNotificationMinutes(), activityTypeOrder: await baby.getDaTypesConfig() })) });
const settingsSet = updateCommand({ name: "set", description: "Set one normalized per-baby setting", positional: ["babyUid", "setting"], params: S.Object({ babyUid, setting: S.Enum(["daytime-range", "notifications", "quick-add-notification", "sticky-notification", "sleep-prediction-notification-minutes", "activity-type-order"] as const), valueJson: S.String({ minLength: 1, maxLength: MAX_JSON }), type: S.Optional(S.String({ maxLength: 256 })) }), handler: (context) => withBaby(context, async (baby) => { const value = parseJson(context.params.valueJson, "valueJson"); switch (context.params.setting) { case "daytime-range": return baby.setDaytimeRange(value as any); case "notifications": return baby.setNotificationsEnabled(requireBoolean(value)); case "quick-add-notification": return baby.setQuickAddNotificationEnabled(requireBoolean(value)); case "sticky-notification": if (!context.params.type) throw new Error("--type is required for sticky-notification"); return baby.setStickyNotificationEnabled(context.params.type, requireBoolean(value)); case "sleep-prediction-notification-minutes": return baby.setSleepPredictionNotificationMinutes(requireNumber(value)); case "activity-type-order": if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("activity-type-order requires a JSON string array"); return baby.setDaTypesConfig(value); } }) });

const caregiversList = readCommand({ name: "list", description: "List caregivers and pending invitations", positional: ["babyUid"], params: S.Object({ babyUid }), handler: (context) => withBaby(context, (baby) => baby.getCaregiversScreenData()) });
const caregiversInvite = createOkCommand({ name: "invite", description: "Invite a caregiver by email", openWorld: true, positional: ["babyUid", "email"], params: S.Object({ babyUid, email: S.String({ format: "email", minLength: 3, maxLength: 320 }) }), confirm: true, handler: (context) => withClient(context, (client) => client.family.sendInvite(context.params.babyUid, context.params.email)) });
const caregiversCancel = deleteOkCommand({ name: "cancel-invite", description: "Cancel a pending caregiver invitation", openWorld: true, positional: ["babyUid", "email"], params: S.Object({ babyUid, email: S.String({ format: "email", minLength: 3, maxLength: 320 }) }), confirm: true, handler: (context) => withClient(context, (client) => client.family.cancelInvite(context.params.babyUid, context.params.email)) });
const caregiversRemove = deleteOkCommand({ name: "remove", description: "Remove an accepted caregiver", openWorld: true, positional: ["babyUid", "caregiverUid"], params: S.Object({ babyUid, caregiverUid: S.String({ minLength: 1, maxLength: 256 }) }), confirm: true, handler: (context) => withClient(context, (client) => client.family.removeCaregiver(context.params.babyUid, context.params.caregiverUid)) });
const caregiversTransfer = deleteOkCommand({ name: "transfer-primary", description: "Transfer primary caregiver ownership", openWorld: true, positional: ["babyUid", "caregiverUid"], params: S.Object({ babyUid, caregiverUid: S.String({ minLength: 1, maxLength: 256 }) }), confirm: true, handler: (context) => withClient(context, (client) => client.family.changePrimaryCaregiver(context.params.babyUid, context.params.caregiverUid)) });
const caregiversAccept = updateOkCommand({ name: "accept", description: "Accept a pending baby invitation", openWorld: true, positional: ["babyUid"], params: S.Object({ babyUid }), confirm: true, handler: (context) => withClient(context, (client) => client.family.acceptInvite(context.params.babyUid)) });
const caregiversDecline = deleteOkCommand({ name: "decline", description: "Decline a pending baby invitation", openWorld: true, positional: ["babyUid"], params: S.Object({ babyUid }), confirm: true, handler: (context) => withClient(context, (client) => client.family.declineInvite(context.params.babyUid)) });
const caregiversLeave = deleteOkCommand({ name: "leave", description: "Leave a shared baby", openWorld: true, positional: ["babyUid"], params: S.Object({ babyUid }), confirm: true, handler: (context) => withClient(context, (client) => client.family.leaveBaby(context.params.babyUid)) });

const attachmentsList = readCommand({ name: "list", description: "List server-managed attachment metadata", positional: ["babyUid", "category"], params: S.Object({ babyUid, category: S.Enum(["dailyActions", "growth", "moments", "teething"] as const), includeDeleted }), handler: (context) => withBaby(context, (baby) => baby.fileMetadata(context.params.category).list({ includeDeleted: context.params.includeDeleted })) });
const attachmentsUpload = updateCommand({ name: "upload", description: "Upload or replace an attachment from base64 data", positional: ["babyUid", "category", "itemUid", "fileName"], params: S.Object({ babyUid, category: S.Enum(["dailyActions", "growth", "moments", "teething"] as const), itemUid: uid, fileName: S.String({ minLength: 1, maxLength: 512 }), dataBase64: S.String({ minLength: 4, maxLength: MAX_JSON }), contentType: S.Optional(S.String({ maxLength: 256 })) }), confirm: true, handler: (context) => withBaby(context, (baby) => baby.uploadAttachment(context.params.category, context.params.itemUid, context.params.fileName, toArrayBuffer(decodeBase64(context.params.dataBase64)), context.params.contentType)) });
const attachmentsDownload = readCommand({ name: "download", description: "Download an attachment as base64", positional: ["babyUid", "category", "itemUid", "fileName"], params: S.Object({ babyUid, category: S.Enum(["dailyActions", "growth", "moments", "teething"] as const), itemUid: uid, fileName: S.String({ minLength: 1, maxLength: 512 }), thumbnail: S.Optional(S.Boolean()) }), handler: (context) => withBaby(context, async (baby) => ({ dataBase64: Buffer.from(await baby.downloadAttachment(context.params.category, context.params.itemUid, context.params.fileName, context.params.thumbnail)).toString("base64") })) });
const attachmentsDelete = deleteOkCommand({ name: "delete", description: "Delete an attachment and its native thumbnail", positional: ["babyUid", "category", "itemUid", "fileName"], params: S.Object({ babyUid, category: S.Enum(["dailyActions", "growth", "moments", "teething"] as const), itemUid: uid, fileName: S.String({ minLength: 1, maxLength: 512 }) }), confirm: true, handler: (context) => withBaby(context, (baby) => baby.deleteAttachment(context.params.category, context.params.itemUid, context.params.fileName)) });

const searchActivitiesCommand = readCommand({ name: "search", description: "Search activities", positional: ["babyUid", "query"], params: S.Object({ babyUid, query: S.String({ maxLength: MAX_TEXT }), type: S.Optional(S.String({ maxLength: 256 })), fromMillis: optionalMillis, toMillis: optionalMillis, limit: S.Optional(S.Number({ minimum: 1, maximum: 1000 })) }), handler: (context) => withBaby(context, (baby) => baby.searchActivities({ query: context.params.query, types: context.params.type ? [context.params.type] : undefined, fromMillis: context.params.fromMillis, toMillis: context.params.toMillis, limit: context.params.limit })) });
const searchNotesCommand = readCommand({ name: "search", description: "Search daily notes", positional: ["babyUid", "query"], params: S.Object({ babyUid, query: S.String({ maxLength: MAX_TEXT }), fromMillis: optionalMillis, toMillis: optionalMillis, limit: S.Optional(S.Number({ minimum: 1, maximum: 1000 })) }), handler: (context) => withBaby(context, (baby) => baby.searchDailyNotes(context.params.query, { fromMillis: context.params.fromMillis, toMillis: context.params.toMillis, limit: context.params.limit })) });

const statisticsOverview = readCommand({ name: "overview", description: "Build the native statistics selector and tab data", positional: ["babyUid"], params: S.Object({ babyUid, type: S.Optional(S.String({ maxLength: 256 })) }), handler: (context) => withBaby(context, (baby) => baby.getStatisticsScreenData(context.params.type)) });
const statisticsActivity = readCommand({ name: "activities", description: "Calculate activity statistics", positional: ["babyUid"], params: S.Object({ babyUid, fromMillis: optionalMillis, toMillis: optionalMillis }), handler: (context) => withBaby(context, (baby) => baby.getActivityStatistics({ fromMillis: context.params.fromMillis, toMillis: context.params.toMillis })) });
const statisticsSleep = readCommand({ name: "statistics", description: "Calculate native sleep duration, nap, awake, wake-up, and bedtime statistics", positional: ["babyUid"], params: S.Object({ babyUid, interval: S.Optional(S.Enum(["last7Days", "last14Days", "last30Days", "thisMonth", "lastMonth", "sinceBirthday"] as const)), fromMillis: optionalMillis, toMillis: optionalMillis, daytimeStartMinutes: S.Optional(S.Number({ minimum: 0, maximum: 1439 })), daytimeEndMinutes: S.Optional(S.Number({ minimum: 0, maximum: 1439 })) }), handler: (context) => withBaby(context, async (baby) => { const range = context.params.fromMillis !== undefined && context.params.toMillis !== undefined ? { fromMillis: context.params.fromMillis, toMillis: context.params.toMillis } : (await baby.getStatisticsDateRange(context.params.interval ?? "last7Days")).range; return baby.getStatisticsSleepDurationData(range, { daytimeStartMinutes: context.params.daytimeStartMinutes, daytimeEndMinutes: context.params.daytimeEndMinutes }); }) });

const sleepPredict = readCommand({ name: "predict", description: "Predict the native sleep schedule", positional: ["babyUid"], params: S.Object({ babyUid, atMillis: optionalMillis, napCount: S.Optional(S.Number({ minimum: 0, maximum: 10 })) }), handler: (context) => withBaby(context, (baby) => baby.predictSleep(context.params.atMillis, context.params.napCount)) });
const sleepRecommendation = readCommand({ name: "recommendation", description: "Get the age-based sleep recommendation", positional: ["babyUid"], params: S.Object({ babyUid, atMillis: optionalMillis }), handler: (context) => withBaby(context, (baby) => baby.getSleepRecommendation(context.params.atMillis)) });
const sleepSchedule = readCommand({ name: "schedule", description: "Get the selected sample sleep schedule", positional: ["babyUid"], params: S.Object({ babyUid, atMillis: optionalMillis, napCount: S.Optional(S.Number({ minimum: 0, maximum: 10 })) }), handler: (context) => withBaby(context, (baby) => baby.getSampleSleepSchedule(context.params.atMillis, context.params.napCount)) });

const exportCsv = readCommand({ name: "activities-csv", description: "Export activities as CSV text", positional: ["babyUid"], params: S.Object({ babyUid, includeDeleted }), handler: (context) => withBaby(context, async (baby) => ({ text: await baby.exportActivitiesCsv({ includeDeleted: context.params.includeDeleted }) })) });
const exportActivitiesPdf = readCommand({ name: "activities-pdf", description: "Export the activity report as base64 PDF", positional: ["babyUid"], params: S.Object({ babyUid, fromMillis: optionalMillis, toMillis: optionalMillis, timeZone: S.Optional(S.String({ maxLength: 128 })) }), handler: (context) => withBaby(context, async (baby) => ({ dataBase64: Buffer.from(await baby.exportActivitiesPdf({ fromMillis: context.params.fromMillis, toMillis: context.params.toMillis, timeZone: context.params.timeZone })).toString("base64") })) });
const exportGrowthPdf = readCommand({ name: "growth-pdf", description: "Export the growth report as base64 PDF", positional: ["babyUid"], params: S.Object({ babyUid }), handler: (context) => withBaby(context, async (baby) => ({ dataBase64: Buffer.from(await baby.exportGrowthPdf()).toString("base64") })) });
const exportTimelinePdf = readCommand({ name: "timeline-pdf", description: "Export the timeline report as base64 PDF", positional: ["babyUid"], params: S.Object({ babyUid, fromMillis: optionalMillis, toMillis: optionalMillis, timeZone: S.Optional(S.String({ maxLength: 128 })) }), handler: (context) => withBaby(context, async (baby) => ({ dataBase64: Buffer.from(await baby.exportTimelinePdf({ fromMillis: context.params.fromMillis, toMillis: context.params.toMillis, timeZone: context.params.timeZone })).toString("base64") })) });

const backupCreate = readCommand({ name: "create", description: "Create a portable JSON backup", positional: ["babyUid"], params: S.Object({ babyUid, includeAttachments: S.Optional(S.Boolean({ default: false })) }), handler: (context) => withBaby(context, (baby) => baby.createBackup({ includeAttachments: context.params.includeAttachments })) });
const backupRestore = deleteOkCommand({ name: "restore", description: "Restore a portable JSON backup", positional: ["babyUid"], params: S.Object({ babyUid, backupJson: S.String({ minLength: 2, maxLength: MAX_JSON }) }), confirm: true, handler: (context) => withBaby(context, (baby) => baby.restoreBackup(parseObject(context.params.backupJson, "backupJson") as any)) });

const syncSnapshot = readCommand({ name: "snapshot", description: "Read the complete polling synchronization snapshot", positional: ["babyUid"], params: S.Object({ babyUid }), handler: (context) => withBaby(context, async (baby) => { const controller = new AbortController(); const changes = baby.watch({ intervalMillis: 60_000, signal: controller.signal }); try { const first = await changes.next(); return first.value ?? []; } finally { controller.abort(); await changes.return(undefined); } }) });

export const babyDaybookCommands = defineGroup({
  name: "baby-daybook",
  description: "Manage Baby Daybook accounts and baby-tracking data",
  scope: ["cli", "mcp", "sdk"] as const,
  secrets: {
    refreshToken: { env: "BABY_DAYBOOK_REFRESH_TOKEN", description: "Firebase refresh token", optional: true },
    email: { env: "BABY_DAYBOOK_EMAIL", description: "Linked Baby Daybook email", optional: true },
    password: { env: "BABY_DAYBOOK_PASSWORD", description: "Linked Baby Daybook password", optional: true },
  },
  children: [
    defineGroup({ name: "log", description: "Log everyday care quickly", children: [logPump, logBottle, logDiaper, logMedicine, logActivity] }),
    defineGroup({
      name: "timeline",
      description: "Review and manage tracked activities",
      children: [
        activitiesRecent,
        activitiesActive,
        activitiesList,
        searchActivitiesCommand,
        activitiesDelete,
        defineGroup({ name: "timer", description: "Control timed activities", children: [activitiesStart, activitiesStop, activitiesPause, activitiesResume] }),
      ],
    }),
    defineGroup({ name: "babies", description: "Find baby profiles", children: [babiesList, babiesGet] }),
    defineGroup({ name: "sleep", description: "Understand and predict sleep", children: [sleepPredict, sleepRecommendation, sleepSchedule, statisticsSleep] }),
    defineGroup({
      name: "journal",
      description: "Keep growth, milestones, notes, and teething records",
      children: [
        defineGroup({ name: "growth", description: "Track growth measurements", children: [growthList, growthAdd, growthDelete] }),
        defineGroup({ name: "moments", description: "Track development moments", children: [momentsList, momentsAdd, momentsDelete] }),
        defineGroup({ name: "notes", description: "Manage daily notes", children: [notesGet, notesSet, searchNotesCommand, notesDelete] }),
        defineGroup({ name: "teeth", description: "Manage teething records", children: [teethList, teethSet, teethDelete] }),
      ],
    }),
    defineGroup({ name: "reminders", description: "Plan and dismiss care reminders", children: [remindersList, remindersAdd, remindersDismiss, remindersDelete] }),
    defineGroup({ name: "insights", description: "Summarize care patterns", children: [statisticsOverview, statisticsActivity] }),
    defineGroup({
      name: "manage",
      description: "Manage profiles, sharing, and customization",
      children: [
        defineGroup({ name: "account", description: "Manage the account", children: [sessionStatus, accountUpdateDisplayName, accountSendVerification, accountDelete] }),
        defineGroup({ name: "babies", description: "Create and change baby profiles", children: [babiesCreate, babiesUpdate, babiesDelete] }),
        defineGroup({ name: "activity-types", description: "Customize activity types", children: [activityTypesList, activityTypesCreate, activityTypesUpdate, activityTypesDelete] }),
        defineGroup({ name: "activity-groups", description: "Customize activity groups", children: [groupsList, groupsCreate, groupsUpdate, groupsDelete] }),
        defineGroup({ name: "settings", description: "Manage baby settings", children: [settingsGet, settingsSet] }),
        defineGroup({ name: "caregivers", description: "Manage family sharing", children: [caregiversList, caregiversInvite, caregiversCancel, caregiversRemove, caregiversTransfer, caregiversAccept, caregiversDecline, caregiversLeave] }),
      ],
    }),
    defineGroup({ name: "reports", description: "Export reports", children: [exportCsv, exportActivitiesPdf, exportGrowthPdf, exportTimelinePdf] }),
    defineGroup({
      name: "advanced",
      description: "Use raw records, files, backups, and synchronization internals",
      children: [
        defineGroup({
          name: "raw",
          description: "Apply raw JSON record patches",
          children: [
            defineGroup({ name: "activities", children: [activitiesUpdate] }),
            defineGroup({ name: "growth", children: [growthUpdate] }),
            defineGroup({ name: "moments", children: [momentsUpdate] }),
            defineGroup({ name: "reminders", children: [remindersUpdate] }),
          ],
        }),
        defineGroup({ name: "attachments", description: "Manage attachment objects", children: [attachmentsList, attachmentsUpload, attachmentsDownload, attachmentsDelete] }),
        defineGroup({ name: "backup", description: "Create and restore backups", children: [backupCreate, backupRestore] }),
        defineGroup({ name: "sync", description: "Inspect synchronization state", children: [syncSnapshot] }),
      ],
    }),
  ],
});

assertCompleteCommandMetadata(babyDaybookCommands);

function effectAnnotations(effect: CommandEffect, openWorld: boolean): ToolAnnotations {
  return {
    readOnlyHint: effect === "read",
    destructiveHint: effect === "update" || effect === "delete",
    idempotentHint: effect === "read",
    openWorldHint: openWorld,
  };
}

function assertCompleteCommandMetadata(root: Group<any>): void {
  const visit = (node: Group<any> | Command<any, any, any, any>): void => {
    if (node.kind === "command") {
      if (node.title === undefined || node.annotations === undefined) {
        throw new Error(`Command ${node.name} is missing title or effect metadata`);
      }
      return;
    }
    node.children.forEach(visit);
  };
  visit(root);
}

async function resolveBabyUid(client: BabyDaybookClient, reference?: string): Promise<string> {
  const babies = (await client.listBabies()).filter((baby) => !baby.deleted);
  if (reference === undefined) {
    if (babies.length === 1) return babies[0]!.uid;
    if (babies.length === 0) throw new UserError("No active babies are available on this account");
    throw new UserError("More than one baby is available; pass --baby with an exact name or UID");
  }
  const normalized = reference.trim();
  const uidMatch = babies.find((baby) => baby.uid === normalized);
  if (uidMatch) return uidMatch.uid;
  const nameMatches = babies.filter((baby) => baby.name.trim().toLocaleLowerCase() === normalized.toLocaleLowerCase());
  if (nameMatches.length === 1) return nameMatches[0]!.uid;
  if (nameMatches.length > 1) throw new UserError(`Baby name ${JSON.stringify(reference)} is ambiguous; pass the baby UID`);
  throw new UserError(`Baby ${JSON.stringify(reference)} was not found`);
}

async function resolveActivityGroupUid(
  baby: BabyClient,
  type: string,
  reference: string | undefined,
  reuseLast: boolean,
): Promise<string> {
  const groups = (await baby.listGroups(type)).filter((group) => !group.deleted);
  if (reference !== undefined) {
    const normalized = reference.trim();
    const uidMatch = groups.find((group) => group.uid === normalized);
    if (uidMatch) return uidMatch.uid;
    const titleMatches = groups.filter((group) => group.title.trim().toLocaleLowerCase() === normalized.toLocaleLowerCase());
    if (titleMatches.length === 1) return titleMatches[0]!.uid;
    if (titleMatches.length > 1) throw new UserError(`Group title ${JSON.stringify(reference)} is ambiguous; pass the group UID`);
    throw new UserError(`No active ${type} group matches ${JSON.stringify(reference)}`);
  }
  if (reuseLast) {
    const lastGroupUid = (await baby.getLastActivity(type))?.groupUid;
    if (lastGroupUid && groups.some((group) => group.uid === lastGroupUid)) return lastGroupUid;
  }
  if (groups.length === 0) return "";
  if (groups.length === 1) return groups[0]!.uid;
  throw new UserError(`Multiple ${type} groups are available; choose one of: ${groups.map((group) => group.title || group.uid).join(", ")}`);
}

function canonicalVolume(value: number, unit: "milliliters" | "fluidOunces" | undefined): number {
  if (!Number.isFinite(value) || value <= 0) throw new UserError("Volume must be greater than zero");
  const milliliters = unit === "fluidOunces" ? convertValueToMetric(value, "volume") : value;
  if (milliliters > 5_000) throw new UserError("Volume must not exceed 5000 milliliters");
  return milliliters;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON`, { cause: error });
  }
}

function parseObject(value: string, label: string): Record<string, unknown> {
  const parsed = parseJson(value, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Setting value must be a JSON boolean");
  return value;
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Setting value must be a finite JSON number");
  return value;
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("dataBase64 must be canonical base64");
  }
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function toJsonValue(value: unknown): Static<ReturnType<typeof S.Json>> {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? Buffer.from(item).toString("base64") : item));
}
