export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface BabyDaybookConfig {
  apiKey: string;
  appId: string;
  androidPackageName: string;
  androidCertificateSha1: string;
  projectId: string;
  storageBucket: string;
  functionsRegion: string;
}

export interface AuthSessionData {
  idToken: string;
  refreshToken?: string;
  userId: string;
  email?: string;
  displayName?: string;
  expiresAt: number;
}

export type AuthSessionSnapshot = AuthSessionData;

export type SignInProvider = "google" | "facebook" | "apple" | "password";
export type DeletionFlag = boolean | 0 | 1;
export type Gender = "male" | "female" | "other" | string;
export type ActivitySide = "left" | "right" | string;
export type ActivityReaction = "liked" | "neutral" | "disliked" | string;
export type ReminderType = "basic" | "advanced" | "advanced_repeat_days" | "advanced_repeat_weekdays";
export type ToothName = "central_incisor" | "lateral_incisor" | "canine" | "first_molar" | "second_molar";
export type ToothJaw = "upper" | "lower";
export type ToothSide = "left" | "right";
export type ToothState = "none" | "erupted" | "shed";
export type BabySettingType =
  | "STICKY_SINGLE_ACTION_NOTIFICATION"
  | "STICKY_NOTIFICATION"
  | "NOTIFICATIONS_ENABLED"
  | "SLEEP_PREDICTION_NOTIFICATIONS"
  | "DA_TYPES_CONFIG";
export type BuiltInActivityType =
  | "breastfeeding" | "bottle" | "diaper_change" | "sleeping" | "food"
  | "pump" | "drink" | "bath" | "potty" | "toothbrushing" | "medicine"
  | "temperature" | "doctor_visit" | "vaccination" | "symptom" | "crying"
  | "tummy_time" | "walking_outside" | "playtime" | "other";

export interface CloudRecord {
  svt?: number;
  deleted?: DeletionFlag;
}

export interface Baby extends CloudRecord {
  uid: string;
  userUid: string;
  updatedMillis?: number;
  name: string;
  gender?: Gender;
  birthdayMillis?: number;
  photoBase64?: string;
  uiColorCode?: number;
  isPremature?: boolean;
  expectedBirthdayMillis?: number;
  daTypesConfig?: string;
  convertUnits?: boolean;
  daytimeRange?: string;
  sleepPredictionEnabled?: boolean;
  sleepPredictionNapCount?: number;
}

export interface User extends CloudRecord {
  uid: string;
  provider?: SignInProvider;
  providerUid?: string;
  displayName?: string;
  email?: string;
  emailMD5?: string;
  profilePhotoUrl?: string;
  referringUserUid?: string;
}

export interface BabyDataRecord extends CloudRecord {
  uid: string;
  userUid: string;
  babyUid: string;
  updatedMillis?: number;
}

export interface ActivityType extends BabyDataRecord {
  title: string;
  color?: string;
  icon?: string;
  category?: string;
  hasDuration?: boolean;
  hasAmount?: boolean;
  hasReaction?: boolean;
}

export type CreateActivityTypeInput = Omit<ActivityType, "uid" | "userUid" | "babyUid" | "updatedMillis" | "svt" | "deleted"> & {
  uid?: string;
};

export interface DailyAction extends BabyDataRecord {
  type: string;
  startMillis: number;
  notes?: string;
  groupUid?: string;
  endMillis?: number;
  pauseMillis?: number;
  duration?: number;
  leftDuration?: number;
  rightDuration?: number;
  inProgress?: boolean;
  side?: ActivitySide;
  temperature?: number;
  volume?: number;
  amount?: number;
  amountUnit?: string;
  reaction?: ActivityReaction;
  pee?: boolean;
  poo?: boolean;
  hairWash?: boolean;
}

export interface ActivityGroup extends BabyDataRecord {
  title: string;
  description?: string;
  daType?: string;
}

export interface DefaultActivityGroupDefinition {
  daType: BuiltInActivityType;
  messageKey: string;
  title: string;
}

export type DefaultActivityGroupTitleResolver = (definition: Readonly<DefaultActivityGroupDefinition>) => string;

export interface CreateBabyOptions {
  resolveDefaultGroupTitle?: DefaultActivityGroupTitleResolver;
}

export type CreateActivityGroupInput = Omit<ActivityGroup, "uid" | "userUid" | "babyUid" | "updatedMillis" | "svt" | "deleted" | "daType"> & {
  daType: string;
  uid?: string;
};

export interface GrowthEntry extends BabyDataRecord {
  dateMillis: number;
  weight?: number;
  height?: number;
  headSize?: number;
  notes?: string;
}

export type CreateGrowthInput = Omit<GrowthEntry, "uid" | "userUid" | "babyUid" | "updatedMillis" | "svt" | "deleted" | "dateMillis"> & {
  uid?: string;
  dateMillis?: number;
};

export interface Moment extends BabyDataRecord {
  dateMillis: number;
  description?: string;
}

export interface MomentMonth {
  monthId: string;
  dateMillis: number;
  moments: Moment[];
}

export interface MomentMonthListOptions extends ListOptions {
  fromMillis?: number;
  toMillis?: number;
  timeZone?: string;
}

export type CreateMomentInput = Omit<Moment, "uid" | "userUid" | "babyUid" | "updatedMillis" | "svt" | "deleted" | "dateMillis"> & {
  uid?: string;
  dateMillis?: number;
};

export interface DailyNote extends BabyDataRecord {
  note: string;
}

export interface Tooth extends BabyDataRecord {
  name: ToothName;
  jaw: ToothJaw;
  side: ToothSide;
  erupted?: boolean;
  eruptedMillis?: number;
  shed?: boolean;
  shedMillis?: number;
  notes?: string;
}

export type CreateToothInput = Pick<Tooth, "name" | "jaw" | "side"> & Pick<Partial<Tooth>, "notes">;

export interface AgeInterval {
  unit: "month" | "year";
  from: number;
  to: number;
}

export interface ToothChartItem {
  order: number;
  name: ToothName;
  jaw: ToothJaw;
  color: string;
  erupts: AgeInterval;
  sheds: AgeInterval;
}

export interface ToothDescriptor extends Omit<ToothChartItem, "order"> {
  uid: string;
  side: ToothSide;
  chartOrder: number;
}

export interface ToothMapItem extends ToothDescriptor {
  state: ToothState;
  tooth?: Tooth;
}

export interface Reminder extends BabyDataRecord {
  daType?: string;
  groupUid?: string;
  type: ReminderType;
  dateMillis: number;
  intervalMillis?: number;
  repeatDays?: number;
  repeatWeekdays?: string;
  dndFrom?: string;
  dndTo?: string;
  dismissedMillis?: number;
}

export type CreateReminderInput = Omit<Partial<Reminder>, "uid" | "userUid" | "babyUid" | "updatedMillis" | "svt" | "deleted" | "daType"> & {
  daType: string;
  uid?: string;
};

export interface ReminderScheduleContext {
  nowMillis?: number;
  lastActivity?: DailyAction;
  activityType?: ActivityType;
  lastFeedingFromStart?: boolean;
}

export interface ReminderSchedule {
  reminder: Reminder;
  nextMillis?: number;
  expiredMillis?: number;
  nextIsInDnd: boolean;
  expiredIsInDnd: boolean;
}

export interface ReminderScheduleListOptions extends ListOptions {
  nowMillis?: number;
  lastFeedingFromStart?: boolean;
}

export interface QuickLaunchItem {
  activityType: ActivityType;
  lastActivity?: DailyAction;
  reminderSchedule?: ReminderSchedule;
}

export interface BabySetting extends CloudRecord {
  uid: string;
  babyUid: string;
  settingType: BabySettingType;
  params?: string;
}

export interface NotificationsEnabledParams {
  enabled: boolean;
}

export interface QuickAddNotificationParams {
  enabled: boolean;
}

export interface StickyNotificationParams {
  daType: string;
  enabled: boolean;
}

export interface SleepPredictionNotificationsParams {
  minutesBeforeSleep: number;
}

export interface DaTypesConfigParams {
  daTypesConfig: string;
}

export interface StickyNotificationSetting extends StickyNotificationParams {
  uid: string;
}

export interface FileMetadata extends CloudRecord {
  uid?: string;
  itemUid: string;
  babyUid: string;
  fileName: string;
}

export interface Purchase extends CloudRecord {
  userUid: string;
  productId: string;
  expirationMillis?: number;
  willRenew?: boolean;
}

export interface BabyAcceptedInvite extends CloudRecord {
  babyUid: string;
  userUid: string;
  acceptedMillis?: number;
}

export interface BabyPendingInvite extends CloudRecord {
  babyUid: string;
  userEmailMD5: string;
  userEmail?: string;
}

export interface UserAcceptedInvite extends CloudRecord {
  babyUid: string;
  acceptedMillis?: number;
}

export interface UserCreatedBaby extends CloudRecord {
  babyUid: string;
  createdMillis?: number;
}

export interface UserPendingInvite extends CloudRecord {
  babyUid: string;
  invitedMillis?: number;
}

export interface CaregiverInfo {
  user: User;
  isPremium: boolean;
}

export interface BabyCaregiversScreenData {
  currentUser?: User;
  caregivers: User[];
  pendingInvites: BabyPendingInvite[];
  isPrimaryCaregiver: boolean;
  babyDeletedFromCloud: boolean;
}

export type AttachmentCategory = "dailyActions" | "growth" | "moments" | "teething";
export type BabyCollectionName = "daTypes" | "dailyActions" | "groups" | "growth" | "moments" | "dailyNotes" | "teething";
export type BabySyncCollectionName =
  | "baby"
  | BabyCollectionName
  | "dailyActionsFiles"
  | "growthFiles"
  | "momentsFiles"
  | "teethingFiles"
  | "acceptedInvites"
  | "pendingInvites"
  | "reminders"
  | "settings"
  | "caregivers"
  | "caregiversPurchases";

export interface ListOptions {
  includeDeleted?: boolean;
  pageSize?: number;
}

export interface SaveOptions {
  merge?: boolean;
  serverTimestamp?: boolean;
}

export interface FirestoreDocument<T = Record<string, unknown>> {
  id: string;
  path: string;
  createTime?: string;
  updateTime?: string;
  data: T;
}

export interface BabyDaybookBackupAttachment {
  category: AttachmentCategory;
  itemUid: string;
  fileName: string;
  contentType: string;
  dataBase64: string;
}

export interface CreateBackupOptions {
  includeAttachments?: boolean;
}

export interface BabyUnitMigrationOptions {
  temperatureFahrenheit: boolean;
  volumeFluidOunces: boolean;
  growthWeightPoundsAndOunces: boolean;
  growthHeightInches: boolean;
  growthHeadSizeInches: boolean;
  persistBackup: (backup: BabyDaybookBackup) => void | Promise<void>;
  atMillis?: number;
}

export interface BabyUnitMigrationResult {
  baby: Baby;
  backup: BabyDaybookBackup;
  convertedActivities: number;
  convertedGrowthEntries: number;
}

export interface BabyDaybookBackup {
  format: "baby-daybook-sdk-backup";
  version: 2;
  createdAt: string;
  baby: Baby;
  activityTypes: ActivityType[];
  activities: DailyAction[];
  groups: ActivityGroup[];
  growth: GrowthEntry[];
  moments: Moment[];
  dailyNotes: DailyNote[];
  teething: Tooth[];
  reminders: Reminder[];
  settings: BabySetting[];
  files: Record<AttachmentCategory, FileMetadata[]>;
  attachmentsIncluded: boolean;
  attachments: BabyDaybookBackupAttachment[];
}

export interface ActivitySummary {
  count: number;
  totalDurationMillis: number;
  totalVolume: number;
  totalAmount: number;
  byType: Record<string, { count: number; durationMillis: number; volume: number; amount: number }>;
}

export interface ChangeEvent {
  collection: BabySyncCollectionName;
  type: "added" | "modified" | "deleted";
  id: string;
  value: CloudRecord;
}

export type GrowthReferenceSource =
  | "cdc_0_36_months"
  | "cdc_2_20_years"
  | "cdcDS_0_36_months"
  | "cdcDS_2_20_years"
  | "who_0_13_weeks"
  | "who_0_60_months";
export type GrowthMeasurement = "weight" | "height" | "headSize";
export type GrowthRangeUnit = "weeks" | "months" | "years";

export interface GrowthPercentileInput {
  source: GrowthReferenceSource;
  gender: "male" | "female";
  measurement: GrowthMeasurement;
  age: number;
  value: number;
}

export interface GrowthPercentileResult {
  percentile: number;
  zScore: number;
  rangeUnit: GrowthRangeUnit;
  referenceValues: Record<5 | 10 | 25 | 50 | 75 | 90 | 95, number>;
}

export interface ActivitySearchOptions {
  query?: string;
  types?: readonly string[];
  groupUids?: readonly string[];
  groupsByType?: Readonly<Record<string, readonly string[]>>;
  reactions?: readonly ActivityReaction[];
  parameters?: readonly ActivityParameter[];
  fromMillis?: number;
  toMillis?: number;
  offset?: number;
  limit?: number;
  includeDeleted?: boolean;
}

export type ActivityParameter = "pee" | "poo" | "hairWash";

export interface DailyNoteSearchOptions {
  fromMillis?: number;
  toMillis?: number;
  offset?: number;
  limit?: number;
  includeDeleted?: boolean;
}

export interface SleepClockTime {
  hour: number;
  minute: number;
}

export interface SleepTimeRange {
  start: SleepClockTime;
  end: SleepClockTime;
}

export type BabyDaytimeRange = SleepTimeRange;

export interface BabyDaytimeRangeValidation {
  startInBounds: boolean;
  endInBounds: boolean;
  durationAtLeastMinimum: boolean;
  durationAtMostMaximum: boolean;
  valid: boolean;
}

export interface SleepDurationConstraint {
  minimumMinutes: number;
  maximumMinutes: number;
}

export interface SleepScheduleConstraints {
  wakeWindow: SleepDurationConstraint;
  nap: SleepDurationConstraint;
  totalNap: SleepDurationConstraint;
  nightSleep: SleepDurationConstraint;
  totalSleep: SleepDurationConstraint;
}

export interface SleepNumberConstraint {
  minimum: number;
  maximum: number;
}

export interface SleepRecommendation {
  ageMonths: number;
  totalSleep: SleepDurationConstraint;
  nightSleep: SleepDurationConstraint;
  napCount: SleepNumberConstraint;
  nap: SleepDurationConstraint;
  totalNap: SleepDurationConstraint;
  wakeWindow: SleepDurationConstraint;
}

export interface GroupedSleepRecommendation {
  agesMonths: readonly number[];
  recommendation: Omit<SleepRecommendation, "ageMonths">;
}

export interface SampleSleepSchedule {
  ageMonths: number;
  napCount: number;
  naps: readonly SleepTimeRange[];
  nightSleep: SleepTimeRange;
  constraints: SleepScheduleConstraints;
}

export interface SleepScheduleSelectionInput {
  ageMonths: number;
  napCount: number;
  expanded?: boolean;
}

export interface DatedSleepTimeRange {
  startMillis: number;
  endMillis: number;
}

export interface DatedSleepSchedule {
  naps: readonly DatedSleepTimeRange[];
  nightSleep: DatedSleepTimeRange;
}

export type PredictedSleepKind = "nap" | "nightSleep";
export type PredictedSleepStatus = "recorded" | "inProgress" | "predicted";

export interface PredictedSleep extends DatedSleepTimeRange {
  kind: PredictedSleepKind;
  status: PredictedSleepStatus;
  number?: number;
}

export interface SleepPredictionInput {
  baby: Baby;
  day: Date | number;
  activities?: readonly DailyAction[];
  napCount?: number;
  now?: Date | number;
}

export interface SleepPredictionResult {
  ageMonths: number;
  sampleSchedule: SampleSleepSchedule;
  sleeps: readonly PredictedSleep[];
}

export interface ActivityStatisticsOptions {
  fromMillis?: number;
  toMillis?: number;
  daytimeStartMinutes?: number;
  daytimeEndMinutes?: number;
}

export interface NumericStatistics {
  count: number;
  sum: number;
  average?: number;
  minimum?: number;
  maximum?: number;
}

export interface ActivityMetricStatistics {
  count: number;
  durationMillis: number;
  amount: number;
  volume: number;
}

export interface DailyActivityStatistics extends ActivityMetricStatistics {
  date: string;
  daytimeSleepMillis: number;
  nightSleepMillis: number;
  awakeMillis: number;
}

export interface SleepStatistics {
  count: number;
  durationMillis: number;
  daytimeDurationMillis: number;
  nightDurationMillis: number;
  napCount: number;
}

export interface ActivityStatisticsReport extends ActivityMetricStatistics {
  byType: Record<string, ActivityMetricStatistics>;
  byGroup: Record<string, ActivityMetricStatistics>;
  byAmountUnit: Record<string, NumericStatistics>;
  byReaction: Record<string, number>;
  byHour: number[];
  temperatures: NumericStatistics;
  sleep: SleepStatistics;
  days: DailyActivityStatistics[];
}

export interface ActivityPdfOptions {
  title?: string;
  babyName?: string;
  babyBirthdayMillis?: number;
  generatedAt?: Date | number;
  fromMillis?: number;
  toMillis?: number;
  includeDeleted?: boolean;
  includeDayTimeline?: boolean;
  includeDayNotes?: boolean;
  includeDaySummaries?: boolean;
  includeActivities?: boolean;
  hourLabelInterval?: 1 | 2 | 3 | 4 | 6 | 12;
  timeZone?: string;
  dailyNotes?: readonly DailyNote[];
  activityTypes?: readonly ActivityType[];
}

export interface GrowthPdfOptions {
  title?: string;
  babyName?: string;
  generatedAt?: Date | number;
  fromMillis?: number;
  toMillis?: number;
  includeDeleted?: boolean;
  weightUnit?: "kg" | "lb";
  lengthUnit?: "cm" | "in";
  includeWeightChart?: boolean;
  includeHeightChart?: boolean;
  includeHeadSizeChart?: boolean;
}

export type TimelinePdfOptions = ActivityPdfOptions;
