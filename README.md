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
- Full JSON backups, restore, activity CSV export, activity summaries, and polling-based change streams.
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

To restore a saved login without retaining the password:

```ts
const client = await BabyDaybookClient.fromRefreshToken(savedRefreshToken);
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

## Family sharing

```ts
await client.family.sendInvite(babyUid, "caregiver@example.com");
await client.family.acceptInvite(babyUid);
await client.family.removeCaregiver(babyUid, caregiverUid);
await client.family.changePrimaryCaregiver(babyUid, caregiverUid);
```

## Attachments and backups

```ts
await baby.uploadAttachment("moments", momentUid, "photo.jpg", jpegBytes, "image/jpeg");
const jpeg = await baby.downloadAttachment("moments", momentUid, "photo.jpg");

const backup = await baby.createBackup();
await baby.restoreBackup(backup);
const csv = await baby.exportActivitiesCsv();
const summary = await baby.summarizeActivities();
```

Backup metadata does not embed attachment bytes. Download files separately when an offline media archive is required.

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
