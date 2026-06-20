export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface BabyDaybookConfig {
  apiKey: string;
  appId: string;
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
export type Gender = "male" | "female" | "other" | string;
export type ActivitySide = "left" | "right" | string;
export type ActivityReaction = "liked" | "neutral" | "disliked" | string;
export type ReminderType = "dailyAction" | "sleepPrediction";
export type ToothJaw = "upper" | "lower";
export type ToothSide = "left" | "right";
export type BabySettingType = "quickAddNotification" | "stickyNotification" | "notificationsEnabled" | "sleepPredictionNotifications" | "daTypesConfig";
export type BuiltInActivityType =
  | "breastfeeding" | "bottle" | "diaper_change" | "sleeping" | "food"
  | "pump" | "drink" | "bath" | "potty" | "toothbrushing" | "medicine"
  | "temperature" | "doctor_visit" | "vaccination" | "symptom" | "crying"
  | "tummy_time" | "walking_outside" | "playtime" | "other";

export interface CloudRecord {
  svt?: number;
  deleted?: boolean;
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
  daytimeRange?: unknown;
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
  color?: number;
  icon?: string;
  category?: string;
  hasDuration?: boolean;
  hasAmount?: boolean;
  hasReaction?: boolean;
}

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

export interface GrowthEntry extends BabyDataRecord {
  dateMillis: number;
  weight?: number;
  height?: number;
  headSize?: number;
  notes?: string;
}

export interface Moment extends BabyDataRecord {
  dateMillis: number;
  description?: string;
}

export interface DailyNote extends BabyDataRecord {
  note: string;
}

export interface Tooth extends BabyDataRecord {
  name: string;
  jaw: ToothJaw;
  side: ToothSide;
  erupted?: boolean;
  eruptedMillis?: number;
  shed?: boolean;
  shedMillis?: number;
  notes?: string;
}

export interface Reminder extends BabyDataRecord {
  daType?: string;
  groupUid?: string;
  type: ReminderType;
  dateMillis: number;
  intervalMillis?: number;
  repeatDays?: number;
  repeatWeekdays?: number[];
  dndFrom?: number;
  dndTo?: number;
  dismissedMillis?: number;
}

export interface BabySetting extends CloudRecord {
  settingType: BabySettingType | string;
  params?: unknown;
}

export interface FileMetadata extends CloudRecord {
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

export type AttachmentCategory = "dailyActions" | "growth" | "moments" | "teething";
export type BabyCollectionName = "daTypes" | "dailyActions" | "groups" | "growth" | "moments" | "dailyNotes" | "teething";

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

export interface BabyDaybookBackup {
  format: "baby-daybook-sdk-backup";
  version: 1;
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
}

export interface ActivitySummary {
  count: number;
  totalDurationMillis: number;
  totalVolume: number;
  totalAmount: number;
  byType: Record<string, { count: number; durationMillis: number; volume: number; amount: number }>;
}

export interface ChangeEvent {
  collection: BabyCollectionName | "reminders" | "settings";
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
  fromMillis?: number;
  toMillis?: number;
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
