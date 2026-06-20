# Baby Daybook SDK

Unofficial, typed JavaScript SDK for accessing a user's Baby Daybook data through the same Firebase services used by the Android app. It is not affiliated with Baby Daybook or DrillyApps.

## Supported functionality

- Firebase email/password, custom-token, refresh-token, Google, Facebook, and Apple credential authentication.
- User profiles, owned babies, shared babies, purchases, caregivers, and pending invitations.
- Activity types, timed activities, feeding sides, groups, growth, moments, daily notes, teething, reminders, and per-baby settings.
- Attachment metadata plus Firebase Storage upload, download, and deletion.
- Soft deletion compatible with Baby Daybook synchronization.
- Local activity and daily-note search matching the app's core filters.
- CDC, WHO, and CDC Down syndrome growth percentile calculations using the app's bundled LMS reference data.
- Baby Daybook's 42 bundled sleep schedules, corrected-age handling, age buckets, transition options, and nap-count selection.
- Full JSON backups, restore, activity CSV/PDF exports, activity summaries, and polling-based change streams.
- PDF exports matching the app's daily-list, growth, and timeline report modes.
- Typed statistics for counts, durations, amounts, units, volumes, reactions, temperatures, hours, groups, and day/night sleep.
- App-compatible reminder scheduling for one-time, activity-relative, day-interval, and weekday reminders, including DND and dismissal handling.
- Baby Daybook sleep recommendations for newborns through 59 months, including grouped age ranges.
- Raw Firestore, Firebase Storage, and callable-function clients for forward-compatible access.

The SDK does not bypass subscription checks. Operations remain subject to the authenticated user's Firebase security-rule permissions and Baby Daybook account status.

## Install

```bash
npm install baby-daybook-sdk
```

## Sign in

```ts
import { BabyDaybookClient } from "baby-daybook-sdk";

const client = await BabyDaybookClient.signInWithEmail(
  process.env.BABY_DAYBOOK_EMAIL!,
  process.env.BABY_DAYBOOK_PASSWORD!,
  {
    onSessionChanged(session) {
      // Persist session.refreshToken in an OS credential store.
    },
  },
);

const babies = await client.listBabies();
const baby = client.baby(babies[0].uid);
const activities = await baby.activities.list();
```

Baby Daybook stores its daytime window as `HH:mm-HH:mm`. The SDK validates the app's 04:00–22:00 bounds and 11–14 hour duration before saving:

```ts
const daytimeRange = await baby.getDaytimeRange();
await baby.setDaytimeRange({
  start: { hour: 7, minute: 0 },
  end: { hour: 20, minute: 0 },
});
```

To restore a saved login without retaining the password:

```ts
const client = await BabyDaybookClient.fromRefreshToken(savedRefreshToken);
```

Account lifecycle mirrors the mobile app. Display-name changes update both Firebase Authentication and the Baby Daybook user document, while sign-out invalidates the local SDK session and emits `undefined` through `onSessionChanged`:

```ts
await client.updateDisplayName("Parent name");
await client.signOut();
```

## Record activities

```ts
const sleep = await baby.startActivity({ type: "sleeping" });
await baby.pauseActivity(sleep.uid);
await baby.resumeActivity(sleep.uid);
await baby.stopActivity(sleep.uid);

const feeding = await baby.startActivity({
  type: "breastfeeding",
  side: "left",
});
await baby.switchBreastfeedingSide(feeding.uid, "right");
await baby.stopActivity(feeding.uid);
```

All direct collection repositories provide `list`, `get`, `save`, `softDelete`, and `hardDelete`. Prefer `softDelete` because the mobile app uses tombstones to synchronize deletions.

## Search and growth

```ts
const nightFeeds = await baby.searchActivities({
  query: "night",
  types: ["bottle", "breastfeeding"],
});
const matchingNotes = await baby.searchDailyNotes("doctor");

const result = calculateGrowthPercentile({
  source: "who_0_60_months",
  gender: "female",
  measurement: "weight",
  age: 12,
  value: 9.1,
});
```

Growth age uses the selected reference dataset's weeks, months, or years. Use `growthAgeAtDate` to convert timestamps and `calculateGrowthValueAtPercentile` to obtain a reference value for percentiles 1 through 99.

## Sleep schedules

The SDK includes the schedule table and selection behavior recovered from the Android app. Sleep prediction supports corrected ages from 2 through 59 months:

```ts
const schedule = await baby.getSampleSleepSchedule();
const dated = materializeSleepSchedule(schedule, new Date());
const prediction = await baby.predictSleep(new Date());

const transitionOptions = getExpandedSleepSchedulesForAge(12);
const oneNapSchedule = selectSleepSchedule({ ageMonths: 12, napCount: 1 });
```

`getSleepSchedulesForAge` follows the app's exact age buckets: monthly schedules through 23 months, then the 24-, 36-, and 48-month tables. `getExpandedSleepSchedulesForAge` includes nearby higher- and lower-nap transition schedules, and `selectSleepSchedule` chooses the exact or nearest nap count with the same lower-count tie break as the app.

`predictSleepSchedule` and `baby.predictSleep` combine that reference schedule with recorded `sleeping` activities. Completed or in-progress naps shift the remaining naps and bedtime through the schedule's wake windows, while generated times use the app's five-minute increments.

The statistics screen's recommendation ranges are also available directly:

```ts
const recommendation = await baby.getSleepRecommendation();
const grouped = listGroupedSleepRecommendations();
```

## PDF exports

The Android app exposes daily-list, growth, and timeline PDF modes. The SDK provides deterministic equivalents suitable for saving, emailing, or further processing:

```ts
const dailyListPdf = await baby.exportActivitiesPdf();
const growthPdf = await baby.exportGrowthPdf({
  weightUnit: "lb",
  lengthUnit: "in",
});
const timelinePdf = await baby.exportTimelinePdf({ hourLabelInterval: 3 });
```

Daily-list reports follow the app's section order: day label, timeline, daily note, summary, and individual activity rows. Daily notes are matched using Baby Daybook's `yyyyMMdd` document IDs in the selected timezone. Growth reports include measurement rows and independently selectable weight, height, and head-size trend sections. Timeline reports group activities by day and reproduce the app's hour-label concept.

## Family sharing

```ts
await client.family.sendInvite(babyUid, "caregiver@example.com");
await client.family.acceptInvite(babyUid);
await client.family.removeCaregiver(babyUid, caregiverUid);
await client.family.changePrimaryCaregiver(babyUid, caregiverUid);
```

## Reminders

Reminder documents use the app's serialized modes: `basic`, `advanced`, `advanced_repeat_days`, and `advanced_repeat_weekdays`. Resolve their current state locally or fetch schedules with the latest matching activity already associated:

```ts
const schedules = await baby.getReminderSchedules({
  nowMillis: Date.now(),
  lastFeedingFromStart: true,
});

for (const schedule of schedules) {
  console.log(schedule.expiredMillis, schedule.nextMillis, schedule.nextIsInDnd);
}
```

## Attachments and backups

```ts
await baby.uploadAttachment("moments", momentUid, "photo.jpg", jpegBytes, "image/jpeg");
const jpeg = await baby.downloadAttachment("moments", momentUid, "photo.jpg");

const backup = await baby.createBackup();
await baby.restoreBackup(backup);
const csv = await baby.exportActivitiesCsv();
const pdf = await baby.exportActivitiesPdf({
  title: "Weekly activity report",
  fromMillis: Date.now() - 7 * 86_400_000,
});
const summary = await baby.summarizeActivities();
const statistics = await baby.getActivityStatistics({
  fromMillis: Date.now() - 7 * 86_400_000,
});
```

Backup metadata does not embed attachment bytes. Download files separately when an offline media archive is required.

The SDK backup is a portable JSON snapshot of cloud data. Baby Daybook's Android backup command instead copies the app's private SQLite database to a `.db` file; the two formats are intentionally not interchangeable.

## Baby settings

```ts
await baby.setNotificationsEnabled(true);
await baby.setQuickAddNotificationEnabled(true);
await baby.setStickyNotificationEnabled("bottle", true);
await baby.setSleepPredictionNotificationMinutes(15);
await baby.setDaTypesConfig(["breastfeeding", "bottle", "sleeping"]);

console.log(await baby.areNotificationsEnabled());
console.log(await baby.listStickyNotifications());
```

These helpers use the app's exact Firestore setting names and JSON-string parameter format. Defaults match the native app when a setting has not been stored.

## Measurement units

Baby Daybook stores synchronized measurements in metric units and applies device-local display preferences. The SDK reproduces the native conversion constants and number precision:

```ts
import {
  formatGrowthLength,
  formatGrowthWeight,
  formatTemperature,
  formatVolume,
} from "baby-daybook-sdk";

formatTemperature(37, "fahrenheit"); // "98.6 °F"
formatVolume(120, "fluidOunces"); // "4.06 fl oz"
formatGrowthWeight(3.5, "poundsAndOunces"); // "7 lb 11.5 oz"
formatGrowthLength(50, "inches"); // "19.7 in"
```

Pure `convertValueToImperial` and `convertValueToMetric` helpers are also exported for volume, temperature, weight, height, and head-size values.

## Change polling

The mobile app uses Firestore listeners. The REST SDK offers an async polling stream that reports equivalent added, modified, and deleted records without requiring the Firebase browser bundle:

```ts
const controller = new AbortController();
for await (const changes of baby.watch({ intervalMillis: 5_000, signal: controller.signal })) {
  console.log(changes);
}
```

## Development

From the repository root with Node.js 24 selected:

```bash
npm run baby-daybook:build
npm run baby-daybook:test
npm run typecheck --workspace baby-daybook-sdk
npm run lint --workspace baby-daybook-sdk
```

Tests use mocked Firebase protocol responses and never access a real account. Live verification requires owner-provided credentials or a refresh token and should use a dedicated test baby.
