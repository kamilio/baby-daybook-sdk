import { activitiesToCsv, summarizeActivities } from "./analytics.js";
import {
  findOverlappingActivities,
  getInProgressActivities,
  getLastActivities,
  getLastActivity,
  getLastAmountForGroup,
  type ActivityAmount,
  type LastActivityOptions,
} from "./activity-queries.js";
import { hasActivityGroupWithSameName, sortActivityGroups } from "./activity-groups.js";
import { AuthSession, BabyDaybookAuth, type AppleCredential, type AuthOptions, type FirebaseAccount, type OAuthCredential } from "./auth.js";
import { parseAppleCallbackUrl } from "./apple.js";
import { BABY_DAYBOOK_ACTIVITY_TYPE_COLORS, BUILT_IN_ACTIVITY_TYPES } from "./constants.js";
import { formatBabyDaybookDayId } from "./day-id.js";
import { createDefaultActivityGroups, createDefaultActivityTypes } from "./defaults.js";
import {
  buildDevelopmentGrowthSummary,
  buildDevelopmentMomentsSummary,
  getLastGrowthWithValues,
  type DevelopmentGrowthOptions,
  type DevelopmentGrowthSummary,
  type DevelopmentMomentsSummary,
} from "./development.js";
import { formatBabyDaytimeRange, isBabyDaytimeRangeValid, parseBabyDaytimeRange } from "./daytime-range.js";
import { FirestoreClient, type FirestoreSetWrite } from "./firestore.js";
import { CallableFunctionsClient, FamilyClient } from "./functions.js";
import { sortGrowthEntries } from "./growth.js";
import { groupMomentsByMonth } from "./moments.js";
import { createNativeRandomUid } from "./native-id.js";
import { paths } from "./paths.js";
import { activitiesToPdf, growthToPdf, timelineToPdf } from "./pdf.js";
import { CollectionRepository } from "./repository.js";
import {
  BABY_DAYBOOK_DEFAULT_REMINDER_INTERVAL_MILLIS,
  getRelevantReminderSchedules,
  normalizeReminderForSave,
  resolveReminderSchedule,
  sortReminderSchedules,
} from "./reminders.js";
import { countSearchActivities, countSearchDailyNotes, searchActivities, searchDailyNotes } from "./search.js";
import {
  BABY_SETTING_TYPES,
  parseDaTypesConfig,
  parseNotificationsEnabled,
  parseQuickAddNotificationEnabled,
  parseSleepPredictionNotificationMinutes,
  parseStickyNotification,
  serializeDaTypesConfig,
  serializeSettingParams,
} from "./settings.js";
import { getSleepRecommendation } from "./sleep-recommendations.js";
import { babyAdjustedAgeMonths, predictSleepSchedule, selectSleepScheduleForBaby } from "./sleep-prediction.js";
import { buildActivityStatistics } from "./statistics.js";
import { FirebaseStorageClient } from "./storage.js";
import { buildToothMap, listToothChartItems, toothUid } from "./teething.js";
import {
  countActivitiesForRange,
  listActivitiesForRange,
  type ActivityRangeOptions,
} from "./timeline.js";
import { convertValueToMetric } from "./units.js";
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
  CreateBabyOptions,
  BabyAcceptedInvite,
  BabyCaregiversScreenData,
  BabyCollectionName,
  BabyDaybookBackup,
  BabyDaybookBackupAttachment,
  BabyDaytimeRange,
  BabyPendingInvite,
  BabySetting,
  BabySyncCollectionName,
  BabyUnitMigrationOptions,
  BabyUnitMigrationResult,
  ChangeEvent,
  CloudRecord,
  CreateBackupOptions,
  CreateActivityGroupInput,
  CreateActivityTypeInput,
  CreateGrowthInput,
  CreateMomentInput,
  CreateReminderInput,
  CreateToothInput,
  DailyAction,
  DailyNote,
  DailyNoteSearchOptions,
  FileMetadata,
  GrowthEntry,
  GrowthPdfOptions,
  ListOptions,
  Moment,
  MomentMonth,
  MomentMonthListOptions,
  Purchase,
  QuickLaunchItem,
  Reminder,
  ReminderSchedule,
  ReminderScheduleListOptions,
  SampleSleepSchedule,
  SleepRecommendation,
  SleepPredictionResult,
  StickyNotificationSetting,
  Tooth,
  ToothChartItem,
  ToothMapItem,
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

  static async signInWithAppleCredential(credential: AppleCredential, options: AuthOptions = {}): Promise<BabyDaybookClient> {
    const auth = new BabyDaybookAuth(options);
    return new BabyDaybookClient({ ...options, session: await auth.signInWithAppleCredential(credential) });
  }

  static signInWithAppleCallback(callbackUrl: string | URL, options: AuthOptions = {}): Promise<BabyDaybookClient> {
    return this.signInWithAppleCredential(parseAppleCallbackUrl(callbackUrl), options);
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

  async listGrowthComparisonBabies(activeBabyUid: string, options: ListOptions = {}): Promise<Baby[]> {
    const activeBaby = await this.getBaby(activeBabyUid);
    if (!activeBaby || (!options.includeDeleted && activeBaby.deleted)) throw new Error(`Baby ${activeBabyUid} does not exist`);
    return (await this.listBabies(options)).filter((baby) => baby.uid !== activeBabyUid && baby.gender === activeBaby.gender);
  }

  async getGrowthComparisonMap(babyUids: readonly string[], options: ListOptions = {}): Promise<Map<string, GrowthEntry[]>> {
    const uniqueBabyUids = [...new Set(babyUids)];
    const entries = await Promise.all(uniqueBabyUids.map(async (babyUid) => [babyUid, await this.baby(babyUid).listGrowth(options)] as const));
    return new Map(entries);
  }

  baby(babyUid: string): BabyClient {
    return new BabyClient(this, babyUid);
  }

  async createBaby(input: Omit<Baby, "uid" | "userUid"> & { uid?: string }, options: CreateBabyOptions = {}): Promise<Baby> {
    if (!input.name.length) throw new RangeError("Baby name must not be empty");
    const uid = input.uid ?? crypto.randomUUID();
    const now = Date.now();
    const baby: Baby = {
      ...input,
      uid,
      userUid: this.session.userId,
      updatedMillis: input.updatedMillis ?? now,
      svt: 0,
      deleted: input.deleted ?? false,
    };
    const activityTypes = createDefaultActivityTypes(uid, now);
    const groups = createDefaultActivityGroups(uid, now, options.resolveDefaultGroupTitle);
    const writes: FirestoreSetWrite[] = [
      { path: paths.baby(uid), data: baby as unknown as Record<string, unknown> },
      {
        path: `${paths.userCreatedBabies(this.session.userId)}/${uid}`,
        data: { babyUid: uid, createdMillis: now, deleted: false },
      },
      ...activityTypes.map((activityType) => ({
        path: `${paths.babyCollection(uid, "daTypes")}/${activityType.uid}`,
        data: activityType as unknown as Record<string, unknown>,
      })),
      ...groups.map((group) => ({
        path: `${paths.babyCollection(uid, "groups")}/${group.uid}`,
        data: group as unknown as Record<string, unknown>,
      })),
    ];
    await this.firestore.setMany(writes);
    return baby;
  }

  async deleteAccount(): Promise<void> {
    await this.functions.call("deleteUserAccount");
  }

  async updateDisplayName(displayName: string): Promise<User> {
    const normalized = displayName.trim();
    if (!normalized) throw new RangeError("Display name must not be empty");
    await this.auth.updateAccount(this.session, { displayName: normalized });
    const current = await this.getUser();
    return this.saveUser({ ...current, uid: this.session.userId, displayName: normalized });
  }

  linkEmailPassword(email: string, password: string): Promise<FirebaseAccount> {
    return this.auth.linkEmailPassword(this.session, email, password);
  }

  sendEmailVerification(): Promise<void> {
    return this.auth.sendEmailVerification(this.session);
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
    this.settings = new CollectionRepository(client.firestore, paths.settings(client.session.userId, babyUid));
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

  async getCaregiversScreenData(): Promise<BabyCaregiversScreenData> {
    const [baby, currentUser, acceptedInvites, pendingInvites] = await Promise.all([
      this.get(),
      this.client.getUser(),
      this.acceptedInvites.list(),
      this.pendingInvites.list(),
    ]);
    if (!baby || baby.deleted) {
      return {
        currentUser,
        caregivers: [],
        pendingInvites: [],
        isPrimaryCaregiver: false,
        babyDeletedFromCloud: true,
      };
    }
    const caregiverUids = [baby.userUid, ...acceptedInvites.filter((invite) => !invite.deleted).map((invite) => invite.userUid)];
    const caregivers = (await Promise.all([...new Set(caregiverUids)].map(async (userUid) =>
      (await this.client.firestore.get<User>(paths.user(userUid)))?.data)))
      .filter((user): user is User => Boolean(user) && !user?.deleted)
      .sort((left, right) => Number(right.uid === baby.userUid) - Number(left.uid === baby.userUid)
        || caregiverSortName(left).localeCompare(caregiverSortName(right))
        || left.uid.localeCompare(right.uid));
    return {
      currentUser,
      caregivers,
      pendingInvites: pendingInvites
        .filter((invite) => !invite.deleted)
        .sort((left, right) => (left.userEmail ?? "").localeCompare(right.userEmail ?? "")
          || left.userEmailMD5.localeCompare(right.userEmailMD5)),
      isPrimaryCaregiver: baby.userUid === this.client.session.userId,
      babyDeletedFromCloud: false,
    };
  }

  async areNotificationsEnabled(): Promise<boolean> {
    return parseNotificationsEnabled(await this.#getSetting(BABY_SETTING_TYPES.notificationsEnabled));
  }

  setNotificationsEnabled(enabled: boolean): Promise<BabySetting> {
    return this.#saveSingletonSetting(BABY_SETTING_TYPES.notificationsEnabled, { enabled });
  }

  async isQuickAddNotificationEnabled(): Promise<boolean> {
    return parseQuickAddNotificationEnabled(await this.#getSetting(BABY_SETTING_TYPES.quickAddNotification));
  }

  setQuickAddNotificationEnabled(enabled: boolean): Promise<BabySetting> {
    return this.#saveSingletonSetting(BABY_SETTING_TYPES.quickAddNotification, { enabled });
  }

  async listStickyNotifications(): Promise<StickyNotificationSetting[]> {
    const settings = await this.settings.list();
    return settings.flatMap((setting) => {
      if (setting.settingType !== BABY_SETTING_TYPES.stickyNotification) return [];
      const params = parseStickyNotification(setting);
      return params ? [{ uid: setting.uid, ...params }] : [];
    });
  }

  async isStickyNotificationEnabled(daType: string): Promise<boolean> {
    return (await this.listStickyNotifications()).find((setting) => setting.daType === daType)?.enabled ?? false;
  }

  async setStickyNotificationEnabled(daType: string, enabled: boolean): Promise<BabySetting> {
    const normalized = daType.trim();
    if (!normalized) throw new RangeError("Activity type must not be empty");
    const current = (await this.settings.list()).find((setting) =>
      setting.settingType === BABY_SETTING_TYPES.stickyNotification
      && parseStickyNotification(setting)?.daType === normalized);
    return this.#saveSetting(current?.uid, BABY_SETTING_TYPES.stickyNotification, { daType: normalized, enabled });
  }

  async getSleepPredictionNotificationMinutes(): Promise<number> {
    return parseSleepPredictionNotificationMinutes(await this.#getSetting(BABY_SETTING_TYPES.sleepPredictionNotifications));
  }

  setSleepPredictionNotificationMinutes(minutesBeforeSleep: number): Promise<BabySetting> {
    if (!Number.isInteger(minutesBeforeSleep) || minutesBeforeSleep < 0) throw new RangeError("Sleep prediction notification minutes must be a non-negative integer");
    return this.#saveSingletonSetting(BABY_SETTING_TYPES.sleepPredictionNotifications, { minutesBeforeSleep });
  }

  async getDaTypesConfig(): Promise<string[]> {
    return parseDaTypesConfig(await this.#getSetting(BABY_SETTING_TYPES.daTypesConfig));
  }

  setDaTypesConfig(daTypes: readonly string[]): Promise<BabySetting> {
    return this.#saveSingletonSetting(BABY_SETTING_TYPES.daTypesConfig, serializeDaTypesConfig(daTypes));
  }

  createActivityType(input: CreateActivityTypeInput): Promise<ActivityType> {
    const color = input.color ?? BABY_DAYBOOK_ACTIVITY_TYPE_COLORS[Math.floor(Math.random() * BABY_DAYBOOK_ACTIVITY_TYPE_COLORS.length)]!;
    return this.saveActivityType({
      category: "",
      hasAmount: false,
      hasDuration: false,
      hasReaction: false,
      icon: "pen_ink",
      ...input,
      color,
      uid: input.uid ?? crypto.randomUUID(),
      userUid: this.client.session.userId,
      babyUid: this.babyUid,
    });
  }

  async saveActivityType(activityType: ActivityType): Promise<ActivityType> {
    if (!activityType.title.trim()) throw new RangeError("Activity type title must not be empty");
    const current = await this.activityTypes.get(activityType.uid);
    return this.activityTypes.save({
      ...activityType,
      userUid: current?.userUid ?? activityType.userUid,
      babyUid: this.babyUid,
      updatedMillis: Date.now(),
    });
  }

  async deleteActivityType(uid: string): Promise<void> {
    if (!uid) throw new RangeError("Activity type must not be empty");
    if ((BUILT_IN_ACTIVITY_TYPES as readonly string[]).includes(uid)) {
      throw new Error("Default activity type cannot be deleted.");
    }

    const baby = await this.get();
    if (!baby) throw new Error(`Baby ${this.babyUid} does not exist`);
    if (baby.userUid !== this.client.session.userId) {
      throw new Error("Only primary caregiver can delete activity type.");
    }

    const [reminders, groups, activities, activityType] = await Promise.all([
      this.reminders.list(),
      this.groups.list(),
      this.activities.list(),
      this.activityTypes.get(uid),
    ]);
    const daTypesConfig = (baby.daTypesConfig ?? "").split(",");
    const configIndex = daTypesConfig.indexOf(uid);
    if (configIndex >= 0) daTypesConfig.splice(configIndex, 1);
    const serializedConfig = daTypesConfig.join(",");

    await this.setDaTypesConfig(daTypesConfig);
    await this.save({ daTypesConfig: serializedConfig });
    await this.#softDeleteAll(this.reminders, reminders.filter((reminder) => reminder.daType === uid));
    await this.#softDeleteAll(this.groups, groups.filter((group) => group.daType === uid));
    await this.#softDeleteAll(this.activities, activities.filter((activity) => activity.type === uid));
    if (activityType && !activityType.deleted) await this.activityTypes.softDelete(uid);
  }

  async listGroups(daType?: string): Promise<ActivityGroup[]> {
    const groups = sortActivityGroups(await this.groups.list());
    return daType === undefined ? groups : groups.filter((group) => group.daType === daType);
  }

  async listActivitiesForRange(options: ActivityRangeOptions): Promise<DailyAction[]> {
    const [activities, activityTypes] = await Promise.all([
      this.activities.list({ includeDeleted: options.includeDeleted }),
      this.activityTypes.list(),
    ]);
    return listActivitiesForRange(activities, activityTypes.filter((type) => type.hasDuration).map((type) => type.uid), options);
  }

  async countActivitiesForRange(options: ActivityRangeOptions): Promise<number> {
    const [activities, activityTypes] = await Promise.all([
      this.activities.list({ includeDeleted: options.includeDeleted }),
      this.activityTypes.list(),
    ]);
    return countActivitiesForRange(activities, activityTypes.filter((type) => type.hasDuration).map((type) => type.uid), options);
  }

  async hasGroupWithSameName(daType: string, title: string, excludingUid?: string): Promise<boolean> {
    return hasActivityGroupWithSameName(await this.groups.list(), daType, title, excludingUid);
  }

  createGroup(input: CreateActivityGroupInput): Promise<ActivityGroup> {
    return this.saveGroup({
      description: "",
      ...input,
      uid: input.uid ?? crypto.randomUUID(),
      userUid: this.client.session.userId,
      babyUid: this.babyUid,
    });
  }

  async saveGroup(group: ActivityGroup): Promise<ActivityGroup> {
    if (!group.title.trim()) throw new RangeError("Group title must not be empty");
    if (!group.daType) throw new RangeError("Group activity type must not be empty");
    const groups = await this.groups.list();
    if (hasActivityGroupWithSameName(groups, group.daType, group.title, group.uid)) {
      throw new Error("A group with this name already exists for the activity type.");
    }
    const current = groups.find((item) => item.uid === group.uid);
    return this.groups.save({
      ...group,
      userUid: current?.userUid ?? group.userUid,
      babyUid: this.babyUid,
      updatedMillis: Date.now(),
    });
  }

  async deleteGroup(uid: string): Promise<void> {
    if (!uid) throw new RangeError("Group must not be empty");
    const group = await this.groups.get(uid);
    if (group && !group.deleted) await this.groups.softDelete(uid);
  }

  async getDailyNote(at: Date | number = Date.now(), timeZone?: string): Promise<DailyNote | undefined> {
    const note = await this.dailyNotes.get(formatBabyDaybookDayId(at, timeZone));
    return note?.deleted ? undefined : note;
  }

  async setDailyNote(note: string, at: Date | number = Date.now(), timeZone?: string): Promise<DailyNote | undefined> {
    const uid = formatBabyDaybookDayId(at, timeZone);
    const current = await this.dailyNotes.get(uid);
    if (note.length === 0) {
      if (current && !current.deleted) await this.dailyNotes.softDelete(uid);
      return undefined;
    }
    return this.dailyNotes.save({
      ...current,
      uid,
      userUid: current?.userUid ?? this.client.session.userId,
      babyUid: this.babyUid,
      updatedMillis: Date.now(),
      deleted: false,
      note,
    });
  }

  async deleteDailyNote(at: Date | number = Date.now(), timeZone?: string): Promise<void> {
    await this.setDailyNote("", at, timeZone);
  }

  createGrowth(input: CreateGrowthInput = {}, atMillis = Date.now()): Promise<GrowthEntry> {
    return this.saveGrowth({
      ...input,
      uid: input.uid ?? crypto.randomUUID(),
      userUid: this.client.session.userId,
      babyUid: this.babyUid,
      dateMillis: input.dateMillis ?? atMillis,
      notes: input.notes ?? "",
      deleted: false,
    }, atMillis);
  }

  async listGrowth(options: ListOptions = {}): Promise<GrowthEntry[]> {
    return sortGrowthEntries(await this.growth.list({ includeDeleted: options.includeDeleted }), options);
  }

  async getLastGrowthWithValues(): Promise<GrowthEntry | undefined> {
    return getLastGrowthWithValues(await this.growth.list());
  }

  async getDevelopmentGrowth(options: DevelopmentGrowthOptions = {}): Promise<DevelopmentGrowthSummary> {
    return buildDevelopmentGrowthSummary(await this.growth.list(), options);
  }

  saveGrowth(growth: GrowthEntry, atMillis = Date.now()): Promise<GrowthEntry> {
    return this.growth.save({ ...growth, babyUid: this.babyUid, updatedMillis: atMillis, svt: 0 });
  }

  async deleteGrowth(uid: string, atMillis = Date.now()): Promise<GrowthEntry> {
    const growth = await this.growth.get(uid);
    if (!growth) throw new Error(`Growth ${uid} does not exist`);
    return this.growth.save({ ...growth, deleted: true, updatedMillis: atMillis, svt: 0 });
  }

  createMoment(input: CreateMomentInput = {}, atMillis = Date.now()): Promise<Moment> {
    return this.saveMoment({
      ...input,
      uid: input.uid ?? crypto.randomUUID(),
      userUid: this.client.session.userId,
      babyUid: this.babyUid,
      dateMillis: input.dateMillis ?? atMillis,
      description: input.description ?? "",
      deleted: false,
    }, atMillis);
  }

  saveMoment(moment: Moment, atMillis = Date.now()): Promise<Moment> {
    return this.moments.save({ ...moment, babyUid: this.babyUid, updatedMillis: atMillis, svt: 0 });
  }

  async deleteMoment(uid: string, atMillis = Date.now()): Promise<Moment> {
    const moment = await this.moments.get(uid);
    if (!moment) throw new Error(`Moment ${uid} does not exist`);
    return this.moments.save({ ...moment, deleted: true, updatedMillis: atMillis, svt: 0 });
  }

  async listMomentMonths(options: MomentMonthListOptions = {}): Promise<MomentMonth[]> {
    return groupMomentsByMonth(await this.moments.list({ includeDeleted: options.includeDeleted }), options);
  }

  async listMomentsForMonth(at: Date | number, options: Omit<MomentMonthListOptions, "fromMillis" | "toMillis"> = {}): Promise<Moment[]> {
    return (await this.listMomentMonths({ ...options, fromMillis: toMillis(at), toMillis: toMillis(at) }))[0]?.moments ?? [];
  }

  async getDevelopmentMoments(limitCount: number): Promise<DevelopmentMomentsSummary> {
    const [moments, files] = await Promise.all([
      this.moments.list(),
      this.fileMetadata("moments").list(),
    ]);
    return buildDevelopmentMomentsSummary(moments, files, limitCount);
  }

  createTooth(input: CreateToothInput, atMillis = Date.now()): Promise<Tooth> {
    return this.saveTooth({
      ...input,
      uid: toothUid(input.name, input.jaw, input.side),
      userUid: this.client.session.userId,
      babyUid: this.babyUid,
      erupted: true,
      eruptedMillis: atMillis,
      shed: false,
      notes: input.notes ?? "",
      deleted: false,
    }, atMillis);
  }

  saveTooth(tooth: Tooth, atMillis = Date.now()): Promise<Tooth> {
    return this.teething.save({ ...tooth, babyUid: this.babyUid, updatedMillis: atMillis, svt: 0 });
  }

  async deleteTooth(uid: string, atMillis = Date.now()): Promise<Tooth> {
    const tooth = await this.teething.get(uid);
    if (!tooth) throw new Error(`Tooth ${uid} does not exist`);
    return this.teething.save({ ...tooth, deleted: true, updatedMillis: atMillis, svt: 0 });
  }

  async save(update: Partial<Baby>, atMillis = Date.now()): Promise<Baby> {
    const current = await this.get();
    if (!current) throw new Error(`Baby ${this.babyUid} does not exist`);
    const baby = { ...current, ...update, uid: this.babyUid, updatedMillis: atMillis, svt: 0 };
    if (!baby.name.length) throw new RangeError("Baby name must not be empty");
    return (await this.client.firestore.set(paths.baby(this.babyUid), baby as unknown as Record<string, unknown>, { merge: true })).data as unknown as Baby;
  }

  async #getSetting(settingType: BabySetting["settingType"]): Promise<BabySetting | undefined> {
    return (await this.settings.list()).find((setting) => setting.settingType === settingType);
  }

  async #saveSingletonSetting(settingType: BabySetting["settingType"], params: object): Promise<BabySetting> {
    const current = await this.#getSetting(settingType);
    return this.#saveSetting(current?.uid, settingType, params);
  }

  #saveSetting(uid: string | undefined, settingType: BabySetting["settingType"], params: object): Promise<BabySetting> {
    return this.settings.save({
      uid: uid ?? crypto.randomUUID(),
      babyUid: this.babyUid,
      settingType,
      params: serializeSettingParams(params),
    });
  }

  async #softDeleteAll<T extends CloudRecord & { uid: string }>(repository: CollectionRepository<T>, items: readonly T[]): Promise<void> {
    await Promise.all(items.filter((item) => !item.deleted).map((item) => repository.softDelete(item.uid)));
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

  saveActivity(activity: DailyAction, atMillis = Date.now()): Promise<DailyAction> {
    return this.activities.save({ ...activity, babyUid: this.babyUid, updatedMillis: atMillis, svt: 0 });
  }

  async deleteActivity(uid: string, atMillis = Date.now()): Promise<DailyAction> {
    const activity = await this.activities.get(uid);
    if (!activity) throw new Error(`Activity ${uid} does not exist`);
    return this.activities.save({ ...activity, deleted: true, updatedMillis: atMillis, svt: 0 });
  }

  async getLastActivity(type: string, options: LastActivityOptions = {}): Promise<DailyAction | undefined> {
    return getLastActivity(await this.activities.list(), type, options);
  }

  async getLastActivities(types?: readonly string[], atMillis = Date.now()): Promise<DailyAction[]> {
    return getLastActivities(await this.activities.list(), types, atMillis);
  }

  async getInProgressActivities(types?: readonly string[]): Promise<DailyAction[]> {
    return getInProgressActivities(await this.activities.list(), types);
  }

  async getInProgressActivity(type: string): Promise<DailyAction | undefined> {
    return (await this.getInProgressActivities([type]))[0];
  }

  async findOverlappingActivities(
    candidate: Pick<DailyAction, "uid" | "type" | "startMillis" | "endMillis" | "inProgress">,
    atMillis = Date.now(),
  ): Promise<DailyAction[]> {
    return findOverlappingActivities(await this.activities.list(), candidate, atMillis);
  }

  async hasOverlappingActivity(
    candidate: Pick<DailyAction, "uid" | "type" | "startMillis" | "endMillis" | "inProgress">,
    atMillis = Date.now(),
  ): Promise<boolean> {
    return (await this.findOverlappingActivities(candidate, atMillis)).length > 0;
  }

  async getLastAmountForGroup(type: string, groupUid: string): Promise<ActivityAmount | undefined> {
    return getLastAmountForGroup(await this.activities.list(), type, groupUid);
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

  async uploadAttachmentThumbnail(category: AttachmentCategory, itemUid: string, fileName: string, body: BodyInit, contentType?: string): Promise<void> {
    const path = this.client.storage.attachmentThumbnailPath(category, this.babyUid, itemUid, fileName);
    await this.client.storage.upload(path, body, contentType);
  }

  downloadAttachment(category: AttachmentCategory, itemUid: string, fileName: string, preferThumbnail = false): Promise<Uint8Array> {
    return this.client.storage.downloadAttachment(category, this.babyUid, itemUid, fileName, preferThumbnail);
  }

  async deleteAttachment(category: AttachmentCategory, itemUid: string, fileName: string): Promise<void> {
    await this.client.storage.deleteAttachment(category, this.babyUid, itemUid, fileName);
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

  async countSearchActivities(options: ActivitySearchOptions = {}): Promise<number> {
    return countSearchActivities(await this.activities.list({ includeDeleted: options.includeDeleted }), options);
  }

  async searchDailyNotes(query: string, options: DailyNoteSearchOptions = {}): Promise<DailyNote[]> {
    return searchDailyNotes(await this.dailyNotes.list({ includeDeleted: options.includeDeleted }), query, options);
  }

  async countSearchDailyNotes(query: string, options: DailyNoteSearchOptions = {}): Promise<number> {
    return countSearchDailyNotes(await this.dailyNotes.list({ includeDeleted: options.includeDeleted }), query, options);
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

  createReminder(input: CreateReminderInput, atMillis = Date.now()): Promise<Reminder> {
    const type = input.type ?? "basic";
    return this.saveReminder({
      ...input,
      uid: input.uid ?? createNativeRandomUid(),
      userUid: "",
      babyUid: this.babyUid,
      type,
      dateMillis: input.dateMillis ?? (type === "basic" ? 0 : atMillis),
      intervalMillis: input.intervalMillis ?? (type === "basic" ? BABY_DAYBOOK_DEFAULT_REMINDER_INTERVAL_MILLIS : 0),
      repeatDays: input.repeatDays ?? (type === "advanced_repeat_days" ? 1 : 0),
      repeatWeekdays: input.repeatWeekdays ?? "",
      dndFrom: input.dndFrom ?? "",
      dndTo: input.dndTo ?? "",
      dismissedMillis: 0,
      deleted: false,
    }, atMillis);
  }

  saveReminder(reminder: Reminder, atMillis = Date.now()): Promise<Reminder> {
    return this.reminders.save({
      ...normalizeReminderForSave(reminder),
      babyUid: this.babyUid,
      updatedMillis: atMillis,
      svt: 0,
    });
  }

  async deleteReminder(uid: string, atMillis = Date.now()): Promise<Reminder> {
    const reminder = await this.reminders.get(uid);
    if (!reminder) throw new Error(`Reminder ${uid} does not exist`);
    return this.reminders.save({ ...reminder, deleted: true, updatedMillis: atMillis, svt: 0 });
  }

  async getRelevantReminderSchedules(options: ReminderScheduleListOptions = {}): Promise<ReminderSchedule[]> {
    return getRelevantReminderSchedules(await this.getReminderSchedules(options), options.nowMillis);
  }

  async getQuickLaunchItems(options: ReminderScheduleListOptions = {}): Promise<QuickLaunchItem[]> {
    const [activityTypes, activities, configuredTypeUids, reminderSchedules] = await Promise.all([
      this.activityTypes.list(),
      this.activities.list(),
      this.getDaTypesConfig(),
      this.getRelevantReminderSchedules(options),
    ]);
    const activeTypes = activityTypes.filter((activityType) => !activityType.deleted);
    const typeMap = new Map(activeTypes.map((activityType) => [activityType.uid, activityType]));
    const orderedTypes = configuredTypeUids.length
      ? configuredTypeUids.flatMap((uid) => {
        const activityType = typeMap.get(uid);
        return activityType ? [activityType] : [];
      })
      : activeTypes;
    const lastActivityMap = new Map(getLastActivities(activities, orderedTypes.map((activityType) => activityType.uid), options.nowMillis)
      .map((activity) => [activity.type, activity]));
    const reminderMap = new Map<string, ReminderSchedule>();
    for (const schedule of reminderSchedules) {
      const daType = schedule.reminder.daType;
      if (daType && !reminderMap.has(daType)) reminderMap.set(daType, schedule);
    }
    return orderedTypes.map((activityType) => ({
      activityType,
      lastActivity: lastActivityMap.get(activityType.uid),
      reminderSchedule: reminderMap.get(activityType.uid),
    }));
  }

  async dismissReminder(uid: string, atMillis = Date.now()): Promise<Reminder> {
    const reminder = await this.reminders.get(uid);
    if (!reminder) throw new Error(`Reminder ${uid} does not exist`);
    return this.reminders.save({ ...reminder, dismissedMillis: atMillis, updatedMillis: atMillis, svt: 0 });
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

  listToothChart(): ToothChartItem[] {
    return listToothChartItems();
  }

  async getToothMap(options: ListOptions = {}): Promise<ToothMapItem[]> {
    return buildToothMap(await this.teething.list(options));
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

  async createBackup(options: CreateBackupOptions = {}): Promise<BabyDaybookBackup> {
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
    const files = { dailyActions: dailyActionsFiles, growth: growthFiles, moments: momentsFiles, teething: teethingFiles };
    const attachmentsIncluded = options.includeAttachments ?? true;
    const attachments = attachmentsIncluded ? await this.#backupAttachments(files) : [];
    return {
      format: "baby-daybook-sdk-backup",
      version: 2,
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
      files,
      attachmentsIncluded,
      attachments,
    };
  }

  async migrateUnitsToMetric(options: BabyUnitMigrationOptions): Promise<BabyUnitMigrationResult> {
    const backup = await this.createBackup({ includeAttachments: false });
    await options.persistBackup(backup);

    const [activities, growthEntries] = await Promise.all([
      this.activities.list(),
      this.growth.list(),
    ]);
    let convertedActivities = 0;
    for (const activity of activities) {
      if (activity.deleted) continue;
      const converted = { ...activity };
      let changed = false;
      if (options.temperatureFahrenheit && activity.temperature !== undefined && activity.temperature !== 0) {
        converted.temperature = convertValueToMetric(activity.temperature, "temperature");
        changed = true;
      }
      if (options.volumeFluidOunces && activity.volume !== undefined && activity.volume !== 0) {
        converted.volume = convertValueToMetric(activity.volume, "volume");
        changed = true;
      }
      if (!changed) continue;
      await this.activities.save({ ...converted, svt: 0 });
      convertedActivities += 1;
    }

    let convertedGrowthEntries = 0;
    for (const growthEntry of growthEntries) {
      if (growthEntry.deleted) continue;
      const converted = { ...growthEntry };
      let changed = false;
      if (options.growthWeightPoundsAndOunces && growthEntry.weight !== undefined && growthEntry.weight !== 0) {
        converted.weight = convertValueToMetric(growthEntry.weight, "weight");
        changed = true;
      }
      if (options.growthHeightInches && growthEntry.height !== undefined && growthEntry.height !== 0) {
        converted.height = convertValueToMetric(growthEntry.height, "height");
        changed = true;
      }
      if (options.growthHeadSizeInches && growthEntry.headSize !== undefined && growthEntry.headSize !== 0) {
        converted.headSize = convertValueToMetric(growthEntry.headSize, "headSize");
        changed = true;
      }
      if (!changed) continue;
      await this.growth.save({ ...converted, svt: 0 });
      convertedGrowthEntries += 1;
    }

    const baby = await this.save({ convertUnits: true }, options.atMillis);
    return { baby, backup, convertedActivities, convertedGrowthEntries };
  }

  async restoreBackup(backup: BabyDaybookBackup): Promise<void> {
    if (backup.format !== "baby-daybook-sdk-backup" || backup.version !== 2) throw new Error("Unsupported Baby Daybook backup format");
    if (backup.baby.uid !== this.babyUid) throw new Error(`Backup belongs to baby ${backup.baby.uid}, not ${this.babyUid}`);
    this.#validateBackupAttachments(backup);
    if (backup.attachmentsIncluded) {
      for (const attachment of backup.attachments) await this.#restoreAttachment(attachment);
    }
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

  async #backupAttachments(files: Record<AttachmentCategory, FileMetadata[]>): Promise<BabyDaybookBackupAttachment[]> {
    const attachments: BabyDaybookBackupAttachment[] = [];
    for (const category of ATTACHMENT_CATEGORIES) {
      for (const item of files[category]) {
        if (item.deleted) continue;
        attachments.push({
          category,
          itemUid: item.itemUid,
          fileName: item.fileName,
          contentType: attachmentContentType(item.fileName),
          dataBase64: Buffer.from(await this.downloadAttachment(category, item.itemUid, item.fileName)).toString("base64"),
        });
      }
    }
    return attachments;
  }

  async #restoreAttachment(attachment: BabyDaybookBackupAttachment): Promise<void> {
    const path = this.client.storage.attachmentPath(attachment.category, this.babyUid, attachment.itemUid, attachment.fileName);
    await this.client.storage.upload(path, decodeBackupBase64(attachment.dataBase64), attachment.contentType);
  }

  #validateBackupAttachments(backup: BabyDaybookBackup): void {
    if (typeof backup.attachmentsIncluded !== "boolean" || !Array.isArray(backup.attachments)) {
      throw new Error("Invalid Baby Daybook backup attachment manifest");
    }
    const expected = new Set<string>();
    for (const category of ATTACHMENT_CATEGORIES) {
      const metadata = backup.files?.[category];
      if (!Array.isArray(metadata)) throw new Error(`Invalid Baby Daybook backup file metadata for ${category}`);
      for (const item of metadata) {
        if (item.babyUid !== this.babyUid) throw new Error(`Attachment metadata belongs to baby ${item.babyUid}, not ${this.babyUid}`);
        if (!item.deleted) expected.add(backupAttachmentKey(category, item.itemUid, item.fileName));
      }
    }
    if (!backup.attachmentsIncluded) {
      if (backup.attachments.length) throw new Error("Metadata-only Baby Daybook backup cannot contain attachment data");
      return;
    }
    const actual = new Set<string>();
    for (const attachment of backup.attachments) {
      if (!ATTACHMENT_CATEGORIES.includes(attachment.category)) throw new Error(`Invalid attachment category ${attachment.category}`);
      if (!attachment.itemUid || !attachment.fileName || !attachment.contentType) throw new Error("Invalid Baby Daybook backup attachment");
      decodeBackupBase64(attachment.dataBase64);
      const key = backupAttachmentKey(attachment.category, attachment.itemUid, attachment.fileName);
      if (!expected.has(key)) throw new Error(`Attachment data has no active metadata: ${key}`);
      if (actual.has(key)) throw new Error(`Duplicate attachment data: ${key}`);
      actual.add(key);
    }
    for (const key of expected) if (!actual.has(key)) throw new Error(`Missing attachment data: ${key}`);
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
    const [baby, acceptedInvites, pendingInvites, ...baseEntries] = await Promise.all([
      this.get(),
      this.acceptedInvites.list({ includeDeleted: true }),
      this.pendingInvites.list({ includeDeleted: true }),
      this.activityTypes.list({ includeDeleted: true }).then((items) => ["daTypes", items] as const),
      this.activities.list({ includeDeleted: true }).then((items) => ["dailyActions", items] as const),
      this.groups.list({ includeDeleted: true }).then((items) => ["groups", items] as const),
      this.growth.list({ includeDeleted: true }).then((items) => ["growth", items] as const),
      this.moments.list({ includeDeleted: true }).then((items) => ["moments", items] as const),
      this.dailyNotes.list({ includeDeleted: true }).then((items) => ["dailyNotes", items] as const),
      this.teething.list({ includeDeleted: true }).then((items) => ["teething", items] as const),
      this.reminders.list({ includeDeleted: true }).then((items) => ["reminders", items] as const),
      this.settings.list({ includeDeleted: true }).then((items) => ["settings", items] as const),
      ...(["dailyActions", "growth", "moments", "teething"] as const).map((category) => this.fileMetadata(category)
        .list({ includeDeleted: true })
        .then((items) => [`${category}Files` as BabySyncCollectionName, items] as const)),
    ]);
    const caregiverUids = new Set<string>();
    if (baby && !baby.deleted) caregiverUids.add(baby.userUid);
    for (const invite of acceptedInvites) if (!invite.deleted) caregiverUids.add(invite.userUid);
    const caregiverData = await Promise.all([...caregiverUids].map(async (userUid) => {
      const [userDocument, purchases] = await Promise.all([
        this.client.firestore.get<User>(paths.user(userUid)),
        new CollectionRepository<Purchase>(this.client.firestore, paths.purchases(userUid), "productId").list({ includeDeleted: true }),
      ]);
      return { user: userDocument?.data, purchases };
    }));
    const entries: readonly (readonly [BabySyncCollectionName, readonly CloudRecord[]])[] = [
      ...baseEntries,
      ["acceptedInvites", acceptedInvites],
      ["pendingInvites", pendingInvites],
      ["caregivers", caregiverData.flatMap(({ user }) => user ? [user] : [])],
      ["caregiversPurchases", caregiverData.flatMap(({ purchases }) => purchases)],
    ];
    const snapshot = new Map<string, CloudRecord>();
    if (baby) snapshot.set(`baby:${baby.uid}`, baby);
    for (const [collection, items] of entries) {
      for (const item of items) snapshot.set(`${collection}:${recordId(collection, item)}`, item);
    }
    return snapshot;
  }
}

function toMillis(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

const ATTACHMENT_CATEGORIES = ["dailyActions", "growth", "moments", "teething"] as const satisfies readonly AttachmentCategory[];

function backupAttachmentKey(category: AttachmentCategory, itemUid: string, fileName: string): string {
  return `${category}:${itemUid}:${fileName}`;
}

function decodeBackupBase64(value: string): ArrayBuffer {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid base64 attachment data in Baby Daybook backup");
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer;
}

function attachmentContentType(fileName: string): string {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  if (extension === "mp4") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  return "application/octet-stream";
}

function recordId(collection: BabySyncCollectionName, record: CloudRecord): string {
  const item = record as any;
  if (collection === "acceptedInvites") return item.userUid;
  if (collection === "pendingInvites") return item.userEmailMD5;
  if (collection.endsWith("Files")) return item.itemUid;
  if (collection === "caregiversPurchases") return `${item.userUid}:${item.productId}`;
  return item.uid ?? item.settingType ?? item.itemUid ?? item.babyUid ?? JSON.stringify(item);
}

function caregiverSortName(user: User): string {
  return user.displayName ?? user.email ?? user.uid;
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
