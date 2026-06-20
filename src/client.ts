import { activitiesToCsv, summarizeActivities } from "./analytics.js";
import { AuthSession, BabyDaybookAuth, type AuthOptions, type OAuthCredential } from "./auth.js";
import { formatBabyDaytimeRange, isBabyDaytimeRangeValid, parseBabyDaytimeRange } from "./daytime-range.js";
import { FirestoreClient } from "./firestore.js";
import { CallableFunctionsClient, FamilyClient } from "./functions.js";
import { paths } from "./paths.js";
import { activitiesToPdf, growthToPdf, timelineToPdf } from "./pdf.js";
import { CollectionRepository } from "./repository.js";
import { resolveReminderSchedule, sortReminderSchedules } from "./reminders.js";
import { searchActivities, searchDailyNotes } from "./search.js";
import { getSleepRecommendation } from "./sleep-recommendations.js";
import { babyAdjustedAgeMonths, predictSleepSchedule, selectSleepScheduleForBaby } from "./sleep-prediction.js";
import { buildActivityStatistics } from "./statistics.js";
import { FirebaseStorageClient } from "./storage.js";
import type {
  ActivityGroup,
  ActivityPdfOptions,
  ActivitySearchOptions,
  ActivityStatisticsOptions,
  ActivityStatisticsReport,
  ActivitySummary,
  ActivityType,
  AttachmentCategory,
  AuthSessionData,
  Baby,
  BabyAcceptedInvite,
  BabyCollectionName,
  BabyDaybookBackup,
  BabyDaytimeRange,
  BabyPendingInvite,
  BabySetting,
  ChangeEvent,
  CloudRecord,
  DailyAction,
  DailyNote,
  FileMetadata,
  GrowthEntry,
  GrowthPdfOptions,
  ListOptions,
  Moment,
  Purchase,
  Reminder,
  ReminderSchedule,
  ReminderScheduleListOptions,
  SampleSleepSchedule,
  SleepRecommendation,
  SleepPredictionResult,
  Tooth,
  TimelinePdfOptions,
  User,
  UserAcceptedInvite,
  UserCreatedBaby,
  UserPendingInvite,
} from "./types.js";

export interface ClientOptions extends AuthOptions {
  session: AuthSession | AuthSessionData;
}

export class BabyDaybookClient {
  readonly auth: BabyDaybookAuth;
  readonly session: AuthSession;
  readonly firestore: FirestoreClient;
  readonly storage: FirebaseStorageClient;
  readonly functions: CallableFunctionsClient;
  readonly family: FamilyClient;
  readonly userAcceptedInvites: CollectionRepository<UserAcceptedInvite>;
  readonly userCreatedBabies: CollectionRepository<UserCreatedBaby>;
  readonly userPendingInvites: CollectionRepository<UserPendingInvite>;
  readonly purchases: CollectionRepository<Purchase>;

  constructor(options: ClientOptions) {
    this.auth = new BabyDaybookAuth(options);
    this.session = options.session instanceof AuthSession ? options.session : this.auth.fromSession(options.session);
    this.firestore = new FirestoreClient(this.session);
    this.storage = new FirebaseStorageClient(this.session);
    this.functions = new CallableFunctionsClient(this.session);
    this.family = new FamilyClient(this.functions);
    this.userAcceptedInvites = new CollectionRepository(this.firestore, paths.userAcceptedInvites(this.session.userId), "babyUid");
    this.userCreatedBabies = new CollectionRepository(this.firestore, paths.userCreatedBabies(this.session.userId), "babyUid");
    this.userPendingInvites = new CollectionRepository(this.firestore, paths.userPendingInvites(this.session.userId), "babyUid");
    this.purchases = new CollectionRepository(this.firestore, paths.purchases(this.session.userId), "productId");
  }

  static async signInWithEmail(email: string, password: string, options: AuthOptions = {}): Promise<BabyDaybookClient> {
    const auth = new BabyDaybookAuth(options);
    return new BabyDaybookClient({ ...options, session: await auth.signInWithEmail(email, password) });
  }

  static async signUpWithEmail(email: string, password: string, options: AuthOptions = {}): Promise<BabyDaybookClient> {
    const auth = new BabyDaybookAuth(options);
    return new BabyDaybookClient({ ...options, session: await auth.signUpWithEmail(email, password) });
  }

  static async signInWithOAuthCredential(credential: OAuthCredential, options: AuthOptions = {}): Promise<BabyDaybookClient> {
    const auth = new BabyDaybookAuth(options);
    return new BabyDaybookClient({ ...options, session: await auth.signInWithOAuthCredential(credential) });
  }

  static async fromRefreshToken(refreshToken: string, options: AuthOptions = {}): Promise<BabyDaybookClient> {
    const auth = new BabyDaybookAuth(options);
    return new BabyDaybookClient({ ...options, session: await auth.fromRefreshToken(refreshToken) });
  }

  async getUser(): Promise<User | undefined> {
    return (await this.firestore.get<User>(paths.user(this.session.userId)))?.data;
  }

  async saveUser(user: User): Promise<User> {
    return (await this.firestore.set(paths.user(this.session.userId), user as unknown as Record<string, unknown>, { merge: true })).data as unknown as User;
  }

  async listBabies(options: ListOptions = {}): Promise<Baby[]> {
    const [created, accepted] = await Promise.all([
      this.userCreatedBabies.list(options),
      this.userAcceptedInvites.list(options),
    ]);
    const ids = [...new Set([...created, ...accepted].filter((item) => !item.deleted).map((item) => item.babyUid))];
    const babies = await Promise.all(ids.map((id) => this.getBaby(id)));
    return babies.filter((baby): baby is Baby => Boolean(baby) && (options.includeDeleted || !baby?.deleted));
  }

  async getBaby(babyUid: string): Promise<Baby | undefined> {
    const document = await this.firestore.get<Baby>(paths.baby(babyUid));
    return document ? { ...document.data, uid: document.data.uid ?? babyUid } : undefined;
  }

  baby(babyUid: string): BabyClient {
    return new BabyClient(this, babyUid);
  }

  async createBaby(input: Omit<Baby, "uid" | "userUid"> & { uid?: string }): Promise<Baby> {
    const uid = input.uid ?? crypto.randomUUID();
    const now = Date.now();
    const baby: Baby = { ...input, uid, userUid: this.session.userId, updatedMillis: input.updatedMillis ?? now };
    await this.firestore.set(paths.baby(uid), baby as unknown as Record<string, unknown>);
    await this.firestore.set(`${paths.userCreatedBabies(this.session.userId)}/${uid}`, {
      babyUid: uid,
      createdMillis: now,
      deleted: false,
    });
    return baby;
  }

  async deleteAccount(): Promise<unknown> {
    return this.functions.call("deleteUserAccount");
  }

  async updateDisplayName(displayName: string): Promise<User> {
    const normalized = displayName.trim();
    if (!normalized) throw new RangeError("Display name must not be empty");
    await this.auth.updateAccount(this.session, { displayName: normalized });
    const current = await this.getUser();
    return this.saveUser({ ...current, uid: this.session.userId, displayName: normalized });
  }

  signOut(): Promise<void> {
    return this.auth.signOut(this.session);
  }
}

export class BabyClient {
  readonly client: BabyDaybookClient;
  readonly babyUid: string;
  readonly activityTypes: CollectionRepository<ActivityType>;
  readonly activities: CollectionRepository<DailyAction>;
  readonly groups: CollectionRepository<ActivityGroup>;
  readonly growth: CollectionRepository<GrowthEntry>;
  readonly moments: CollectionRepository<Moment>;
  readonly dailyNotes: CollectionRepository<DailyNote>;
  readonly teething: CollectionRepository<Tooth>;
  readonly reminders: CollectionRepository<Reminder>;
  readonly settings: CollectionRepository<BabySetting>;
  readonly acceptedInvites: CollectionRepository<BabyAcceptedInvite>;
  readonly pendingInvites: CollectionRepository<BabyPendingInvite>;

  constructor(client: BabyDaybookClient, babyUid: string) {
    this.client = client;
    this.babyUid = babyUid;
    this.activityTypes = this.#repository("daTypes");
    this.activities = this.#repository("dailyActions");
    this.groups = this.#repository("groups");
    this.growth = this.#repository("growth");
    this.moments = this.#repository("moments");
    this.dailyNotes = this.#repository("dailyNotes");
    this.teething = this.#repository("teething");
    this.reminders = new CollectionRepository(client.firestore, paths.reminders(client.session.userId, babyUid));
    this.settings = new CollectionRepository(client.firestore, paths.settings(client.session.userId, babyUid), "settingType");
    this.acceptedInvites = new CollectionRepository(client.firestore, paths.babyAcceptedInvites(babyUid), "userUid");
    this.pendingInvites = new CollectionRepository(client.firestore, paths.babyPendingInvites(babyUid), "userEmailMD5");
  }

  get(): Promise<Baby | undefined> {
    return this.client.getBaby(this.babyUid);
  }

  async getDaytimeRange(): Promise<BabyDaytimeRange> {
    return parseBabyDaytimeRange((await this.get())?.daytimeRange);
  }

  async setDaytimeRange(range: BabyDaytimeRange): Promise<Baby> {
    if (!isBabyDaytimeRangeValid(range)) throw new RangeError("Baby daytime range must start at or after 04:00, end at or before 22:00, and last from 11 to 14 hours");
    return this.save({ daytimeRange: formatBabyDaytimeRange(range) });
  }

  async save(update: Partial<Baby>): Promise<Baby> {
    const current = await this.get();
    if (!current) throw new Error(`Baby ${this.babyUid} does not exist`);
    const baby = { ...current, ...update, uid: this.babyUid, updatedMillis: Date.now() };
    return (await this.client.firestore.set(paths.baby(this.babyUid), baby as unknown as Record<string, unknown>, { merge: true })).data as unknown as Baby;
  }

  async softDelete(): Promise<Baby> {
    const baby = await this.save({ deleted: true });
    await this.client.userCreatedBabies.softDelete(this.babyUid).catch(() => undefined);
    return baby;
  }

  async startActivity(input: Omit<DailyAction, "uid" | "userUid" | "babyUid" | "startMillis" | "updatedMillis"> & { uid?: string; startMillis?: number }): Promise<DailyAction> {
    const now = input.startMillis ?? Date.now();
    return this.activities.save({
      ...input,
      uid: input.uid ?? crypto.randomUUID(),
      userUid: this.client.session.userId,
      babyUid: this.babyUid,
      startMillis: now,
      updatedMillis: Date.now(),
      inProgress: input.inProgress ?? true,
    });
  }

  async stopActivity(uid: string, endMillis = Date.now()): Promise<DailyAction> {
    const activity = await this.activities.get(uid);
    if (!activity) throw new Error(`Activity ${uid} does not exist`);
    return this.activities.save({
      ...activity,
      endMillis,
      duration: Math.max(0, endMillis - activity.startMillis),
      inProgress: false,
      pauseMillis: undefined,
      updatedMillis: Date.now(),
    });
  }

  async pauseActivity(uid: string, pauseMillis = Date.now()): Promise<DailyAction> {
    const activity = await this.activities.get(uid);
    if (!activity) throw new Error(`Activity ${uid} does not exist`);
    return this.activities.save({ ...activity, pauseMillis, inProgress: false, updatedMillis: Date.now() });
  }

  async resumeActivity(uid: string, resumeMillis = Date.now()): Promise<DailyAction> {
    const activity = await this.activities.get(uid);
    if (!activity) throw new Error(`Activity ${uid} does not exist`);
    const pausedFor = activity.pauseMillis ? Math.max(0, resumeMillis - activity.pauseMillis) : 0;
    return this.activities.save({
      ...activity,
      startMillis: activity.startMillis + pausedFor,
      pauseMillis: undefined,
      inProgress: true,
      updatedMillis: Date.now(),
    });
  }

  async switchBreastfeedingSide(uid: string, side: "left" | "right", atMillis = Date.now()): Promise<DailyAction> {
    const activity = await this.activities.get(uid);
    if (!activity) throw new Error(`Activity ${uid} does not exist`);
    const elapsed = Math.max(0, atMillis - activity.startMillis - (activity.leftDuration ?? 0) - (activity.rightDuration ?? 0));
    const previous = activity.side;
    return this.activities.save({
      ...activity,
      side,
      leftDuration: (activity.leftDuration ?? 0) + (previous === "left" ? elapsed : 0),
      rightDuration: (activity.rightDuration ?? 0) + (previous === "right" ? elapsed : 0),
      updatedMillis: Date.now(),
    });
  }

  fileMetadata(category: AttachmentCategory): CollectionRepository<FileMetadata> {
    return new CollectionRepository(this.client.firestore, paths.fileMetadata(this.babyUid, category), "itemUid");
  }

  async uploadAttachment(category: AttachmentCategory, itemUid: string, fileName: string, body: BodyInit, contentType?: string): Promise<FileMetadata> {
    const path = this.client.storage.attachmentPath(category, this.babyUid, itemUid, fileName);
    await this.client.storage.upload(path, body, contentType);
    return this.fileMetadata(category).save({ itemUid, babyUid: this.babyUid, fileName, deleted: false });
  }

  downloadAttachment(category: AttachmentCategory, itemUid: string, fileName: string): Promise<Uint8Array> {
    return this.client.storage.download(this.client.storage.attachmentPath(category, this.babyUid, itemUid, fileName));
  }

  async deleteAttachment(category: AttachmentCategory, itemUid: string, fileName: string): Promise<void> {
    await this.client.storage.delete(this.client.storage.attachmentPath(category, this.babyUid, itemUid, fileName));
    await this.fileMetadata(category).softDelete(itemUid);
  }

  async summarizeActivities(options: ListOptions = {}): Promise<ActivitySummary> {
    return summarizeActivities(await this.activities.list(options));
  }

  async getActivityStatistics(options: ActivityStatisticsOptions = {}): Promise<ActivityStatisticsReport> {
    return buildActivityStatistics(await this.activities.list(), options);
  }

  async exportActivitiesCsv(options: ListOptions = {}): Promise<string> {
    return activitiesToCsv(await this.activities.list(options));
  }

  async exportActivitiesPdf(options: ActivityPdfOptions = {}): Promise<Uint8Array> {
    const [baby, activities, dailyNotes, activityTypes] = await Promise.all([
      this.get(),
      this.activities.list({ includeDeleted: options.includeDeleted }),
      this.dailyNotes.list({ includeDeleted: options.includeDeleted }),
      this.activityTypes.list({ includeDeleted: options.includeDeleted }),
    ]);
    return activitiesToPdf(activities, {
      ...options,
      babyName: options.babyName ?? baby?.name,
      babyBirthdayMillis: options.babyBirthdayMillis ?? baby?.birthdayMillis,
      dailyNotes: options.dailyNotes ?? dailyNotes,
      activityTypes: options.activityTypes ?? activityTypes,
    });
  }

  async exportGrowthPdf(options: GrowthPdfOptions = {}): Promise<Uint8Array> {
    const baby = await this.get();
    return growthToPdf(await this.growth.list({ includeDeleted: options.includeDeleted }), {
      ...options,
      babyName: options.babyName ?? baby?.name,
    });
  }

  async exportTimelinePdf(options: TimelinePdfOptions = {}): Promise<Uint8Array> {
    const baby = await this.get();
    return timelineToPdf(await this.activities.list({ includeDeleted: options.includeDeleted }), {
      ...options,
      babyName: options.babyName ?? baby?.name,
    });
  }

  async searchActivities(options: ActivitySearchOptions = {}): Promise<DailyAction[]> {
    return searchActivities(await this.activities.list({ includeDeleted: options.includeDeleted }), options);
  }

  async searchDailyNotes(query: string, options: { includeDeleted?: boolean } = {}): Promise<DailyNote[]> {
    return searchDailyNotes(await this.dailyNotes.list({ includeDeleted: options.includeDeleted }), query, options);
  }

  async getReminderSchedules(options: ReminderScheduleListOptions = {}): Promise<ReminderSchedule[]> {
    const [reminders, activities, activityTypes] = await Promise.all([
      this.reminders.list({ includeDeleted: options.includeDeleted }),
      this.activities.list(),
      this.activityTypes.list(),
    ]);
    const typeMap = new Map(activityTypes.map((item) => [item.uid, item]));
    const schedules = reminders.map((reminder) => {
      const matchingActivities = activities.filter((activity) =>
        !activity.deleted
        && activity.type === reminder.daType
        && (!reminder.groupUid || activity.groupUid === reminder.groupUid));
      const lastActivity = matchingActivities.reduce<DailyAction | undefined>((latest, activity) =>
        !latest || activity.startMillis > latest.startMillis ? activity : latest, undefined);
      return resolveReminderSchedule(reminder, {
        nowMillis: options.nowMillis,
        lastActivity,
        activityType: reminder.daType ? typeMap.get(reminder.daType) : undefined,
        lastFeedingFromStart: options.lastFeedingFromStart,
      });
    });
    return sortReminderSchedules(schedules);
  }

  async getSampleSleepSchedule(at: Date | number = Date.now(), napCount?: number): Promise<SampleSleepSchedule> {
    const baby = await this.get();
    if (!baby) throw new Error(`Baby ${this.babyUid} does not exist`);
    return selectSleepScheduleForBaby(baby, at, napCount ?? baby.sleepPredictionNapCount);
  }

  async getSleepRecommendation(at: Date | number = Date.now()): Promise<SleepRecommendation> {
    const baby = await this.get();
    if (!baby) throw new Error(`Baby ${this.babyUid} does not exist`);
    return getSleepRecommendation(babyAdjustedAgeMonths(baby, at));
  }

  async predictSleep(day: Date | number = Date.now(), napCount?: number): Promise<SleepPredictionResult> {
    const baby = await this.get();
    if (!baby) throw new Error(`Baby ${this.babyUid} does not exist`);
    return predictSleepSchedule({
      baby,
      day,
      napCount,
      activities: await this.activities.list(),
    });
  }

  async createBackup(): Promise<BabyDaybookBackup> {
    const baby = await this.get();
    if (!baby) throw new Error(`Baby ${this.babyUid} does not exist`);
    const [activityTypes, activities, groups, growth, moments, dailyNotes, teething, reminders, settings, dailyActionsFiles, growthFiles, momentsFiles, teethingFiles] = await Promise.all([
      this.activityTypes.list({ includeDeleted: true }),
      this.activities.list({ includeDeleted: true }),
      this.groups.list({ includeDeleted: true }),
      this.growth.list({ includeDeleted: true }),
      this.moments.list({ includeDeleted: true }),
      this.dailyNotes.list({ includeDeleted: true }),
      this.teething.list({ includeDeleted: true }),
      this.reminders.list({ includeDeleted: true }),
      this.settings.list({ includeDeleted: true }),
      this.fileMetadata("dailyActions").list({ includeDeleted: true }),
      this.fileMetadata("growth").list({ includeDeleted: true }),
      this.fileMetadata("moments").list({ includeDeleted: true }),
      this.fileMetadata("teething").list({ includeDeleted: true }),
    ]);
    return {
      format: "baby-daybook-sdk-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      baby,
      activityTypes,
      activities,
      groups,
      growth,
      moments,
      dailyNotes,
      teething,
      reminders,
      settings,
      files: { dailyActions: dailyActionsFiles, growth: growthFiles, moments: momentsFiles, teething: teethingFiles },
    };
  }

  async restoreBackup(backup: BabyDaybookBackup): Promise<void> {
    if (backup.format !== "baby-daybook-sdk-backup" || backup.version !== 1) throw new Error("Unsupported Baby Daybook backup format");
    if (backup.baby.uid !== this.babyUid) throw new Error(`Backup belongs to baby ${backup.baby.uid}, not ${this.babyUid}`);
    await this.client.firestore.set(paths.baby(this.babyUid), backup.baby as unknown as Record<string, unknown>);
    await Promise.all([
      ...backup.activityTypes.map((item) => this.activityTypes.save(item)),
      ...backup.activities.map((item) => this.activities.save(item)),
      ...backup.groups.map((item) => this.groups.save(item)),
      ...backup.growth.map((item) => this.growth.save(item)),
      ...backup.moments.map((item) => this.moments.save(item)),
      ...backup.dailyNotes.map((item) => this.dailyNotes.save(item)),
      ...backup.teething.map((item) => this.teething.save(item)),
      ...backup.reminders.map((item) => this.reminders.save(item)),
      ...backup.settings.map((item) => this.settings.save(item)),
      ...Object.entries(backup.files).flatMap(([category, files]) => files.map((item) => this.fileMetadata(category as AttachmentCategory).save(item))),
    ]);
  }

  async *watch(options: { intervalMillis?: number; signal?: AbortSignal } = {}): AsyncGenerator<ChangeEvent[]> {
    const interval = options.intervalMillis ?? 5_000;
    const previous = new Map<string, CloudRecord>();
    while (!options.signal?.aborted) {
      const current = await this.#snapshot();
      const changes: ChangeEvent[] = [];
      for (const [key, value] of current) {
        const old = previous.get(key);
        if (!old) changes.push(toChange(key, value, "added"));
        else if (JSON.stringify(old) !== JSON.stringify(value)) changes.push(toChange(key, value, value.deleted ? "deleted" : "modified"));
      }
      for (const [key, value] of previous) if (!current.has(key)) changes.push(toChange(key, value, "deleted"));
      previous.clear();
      for (const [key, value] of current) previous.set(key, value);
      if (changes.length) yield changes;
      await sleep(interval, options.signal);
    }
  }

  #repository<T extends CloudRecord>(collection: BabyCollectionName): CollectionRepository<T> {
    return new CollectionRepository<T>(this.client.firestore, paths.babyCollection(this.babyUid, collection));
  }

  async #snapshot(): Promise<Map<string, CloudRecord>> {
    const entries = await Promise.all([
      this.activityTypes.list({ includeDeleted: true }).then((items) => ["daTypes", items] as const),
      this.activities.list({ includeDeleted: true }).then((items) => ["dailyActions", items] as const),
      this.groups.list({ includeDeleted: true }).then((items) => ["groups", items] as const),
      this.growth.list({ includeDeleted: true }).then((items) => ["growth", items] as const),
      this.moments.list({ includeDeleted: true }).then((items) => ["moments", items] as const),
      this.dailyNotes.list({ includeDeleted: true }).then((items) => ["dailyNotes", items] as const),
      this.teething.list({ includeDeleted: true }).then((items) => ["teething", items] as const),
      this.reminders.list({ includeDeleted: true }).then((items) => ["reminders", items] as const),
      this.settings.list({ includeDeleted: true }).then((items) => ["settings", items] as const),
    ]);
    const snapshot = new Map<string, CloudRecord>();
    for (const [collection, items] of entries) {
      for (const item of items) snapshot.set(`${collection}:${recordId(item)}`, item);
    }
    return snapshot;
  }
}

function recordId(record: CloudRecord): string {
  const item = record as any;
  return item.uid ?? item.settingType ?? item.itemUid ?? item.babyUid ?? JSON.stringify(item);
}

function toChange(key: string, value: CloudRecord, type: ChangeEvent["type"]): ChangeEvent {
  const separator = key.indexOf(":");
  return {
    collection: key.slice(0, separator) as ChangeEvent["collection"],
    id: key.slice(separator + 1),
    type,
    value,
  };
}

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
