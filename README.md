# Baby Daybook SDK

Unofficial, typed JavaScript SDK for accessing a user's Baby Daybook data through the same Firebase services used by the Android app. It is not affiliated with Baby Daybook or DrillyApps.

## Supported functionality

- Firebase email/password, custom-token, refresh-token, Google, Facebook, and Apple credential authentication.
- User profiles, owned babies, shared babies, purchases, caregivers, and pending invitations.
- Activity types, timed activities, feeding sides, groups, growth, moments, daily notes, teething, reminders, and per-baby settings.
- Attachment metadata plus Firebase Storage upload, download, native `thumb_` previews, and paired deletion.
- Soft deletion compatible with Baby Daybook synchronization.
- Local activity and daily-note search matching the app's core filters.
- CDC, WHO, and CDC Down syndrome growth percentile calculations using the app's bundled LMS reference data.
- Baby Daybook's 42 bundled sleep schedules, corrected-age handling, age buckets, transition options, and nap-count selection.
- Full JSON backups, restore, activity CSV/PDF exports, activity summaries, and polling change streams covering all 18 native sync categories.
- PDF exports matching the app's daily-list, growth, and timeline report modes.
- Typed statistics for counts, durations, amounts, units, volumes, reactions, temperatures, hours, groups, and day/night sleep.
- App-compatible reminder scheduling for one-time, activity-relative, day-interval, and weekday reminders, including DND and dismissal handling.
- Baby Daybook sleep recommendations for newborns through 59 months, including grouped age ranges.
- Native-compatible average sleep clock ranges, including crossing-midnight normalization.
- Native sleep-duration constraint loosening and clamping used by prediction adjustments.
- The native 20-position primary-tooth map, ten-row eruption/shed chart, deterministic tooth IDs, colors, and state precedence.
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

The app's average sleep-range calculator is available for sleep prediction and custom reporting. It aligns crossing-midnight sleeps before averaging their local clock times:

```ts
import { calculateAverageSleepRange } from "baby-daybook-sdk";

const averageNight = calculateAverageSleepRange(daytimeRange, completedSleeps, "America/Chicago");
```

Prediction tooling also exposes the app's loose duration bounds, which expand each edge by 10%, round the adjustment to five minutes, and cap it at 30 minutes:

```ts
const looseNap = loosenSleepDurationConstraint(schedule.constraints.nap);
const adjustedMinutes = clampSleepDurationToLooseConstraint(recordedMinutes, schedule.constraints.nap);
```

To restore a saved login without retaining the password:

```ts
const client = await BabyDaybookClient.fromRefreshToken(savedRefreshToken);
```

### Apple accounts and command-line use

Apple sign-in requires a fresh Apple identity token plus either the authorization code returned by Apple's Android/web flow or the matching raw nonce used by a nonce-based flow. The Android app uses the authorization-code form:

```ts
const client = await BabyDaybookClient.signInWithAppleCredential(
  {
    idToken: appleIdentityToken,
    authorizationCode: appleAuthorizationCode,
  },
  {
    onSessionChanged(session) {
      // Persist session?.refreshToken in an OS credential store.
    },
  },
);
```

For platforms that create a nonce, pass `{ idToken, nonce: rawNonce }`; `rawNonce` is the unhashed value whose SHA-256 hash was sent to Apple.

A headless CLI cannot generate a valid Apple identity token by itself. For convenient later CLI access, authenticate once with Apple, then link an email and a strong generated password to the already authenticated account:

```ts
await client.linkEmailPassword("parent@example.com", generatedPassword);
await client.sendEmailVerification();
```

This keeps the existing Firebase user ID, babies, and activity data, while adding email/password as another sign-in method. Do not use `signUpWithEmail` for this migration: it can create a separate Firebase user. Apple remains linked, and subsequent CLI runs can use `signInWithEmail` or the persisted refresh token. If Apple supplied a private-relay address, confirm which email you want associated with the account before linking it.

The repository includes a one-time headed-browser command that performs this migration without asking for an Apple password in the terminal:

```bash
npm run baby-daybook:link-apple
```

The command opens a temporary Chrome, Edge, or Chromium profile, lets Apple handle credentials and two-factor authentication, captures Baby Daybook's native callback through the browser debugging protocol, signs into the existing Firebase user, asks which email to link, generates a 192-bit URL-safe password, and requests email verification. It stores only the rotating Firebase refresh token in `~/.config/baby-daybook/auth.json`; the directory is created with mode `0700` and the file with mode `0600`. Save the generated password in your password manager because it is displayed once and is not written to that file. Use `--email`, `--browser`, or `--auth-file` to override the interactive email, browser executable, or session location.

An Apple app-specific password is not interchangeable with a Baby Daybook password and will not work with Firebase email/password authentication. The password must be linked after a successful Apple session, as the command does. To restore the saved session later:

```ts
import { readFile } from "node:fs/promises";
import { BabyDaybookClient } from "baby-daybook-sdk";

const saved = JSON.parse(await readFile(`${process.env.HOME}/.config/baby-daybook/auth.json`, "utf8"));
const client = await BabyDaybookClient.fromRefreshToken(saved.refreshToken);
```

For a custom browser integration, `createAppleAuthorizationUrl()` recreates the native Android request, `parseAppleCallbackUrl()` validates the returned `intent://callback` credential, and `BabyDaybookClient.signInWithAppleCallback()` completes the Firebase exchange.

Account lifecycle mirrors the mobile app. Display-name changes update both Firebase Authentication and the Baby Daybook user document, while sign-out invalidates the local SDK session and emits `undefined` through `onSessionChanged`:

```ts
await client.updateDisplayName("Parent name");
await client.signOut();
```

Creating a baby also initializes the same 20 built-in activity types and 39 default groups as the Android app. The SDK sends the baby, ownership record, activity types, and groups in one atomic Firestore commit, so a rejected request cannot leave a partial profile:

```ts
const created = await client.createBaby({
  name: "Baby",
  birthdayMillis: Date.parse("2026-01-01T00:00:00Z"),
});

await client.baby(created.uid).save({
  name: "Baby",
  gender: "female",
  isPremature: true,
  expectedBirthdayMillis: Date.parse("2026-01-15T00:00:00Z"),
});
```

Baby profile saves match the native editor: the name must contain at least one character, all entered profile fields are preserved without hidden birthday or premature-birth normalization, and each save writes `svt: 0` with a fresh `updatedMillis` synchronization stamp.

Default group names use the app's English labels. A caller that has another localization catalog can resolve the native message keys while creating the baby:

```ts
await client.createBaby({ name: "Baby" }, {
  resolveDefaultGroupTitle({ messageKey, title }) {
    return translations[messageKey] ?? title;
  },
});
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

await baby.saveActivity({ ...feeding, notes: "Good latch" });
await baby.deleteActivity(feeding.uid);
```

`saveActivity` mirrors the Android editor by preserving type-specific fields while applying the native update and synchronization stamps. `deleteActivity` writes the same synchronized tombstone used by the app rather than hard-deleting history.

The native activity queries are available without a local SQLite dependency:

```ts
const lastBottle = await baby.getLastActivity("bottle");
const activeTimers = await baby.getInProgressActivities();
const previousAmount = await baby.getLastAmountForGroup("bottle", groupUid);
const overlaps = await baby.findOverlappingActivities(candidateActivity);
```

Last-activity queries reproduce the app's one-minute future-entry grace window. Overlap detection uses the same inclusive start boundary and treats an existing in-progress activity as open-ended.

Primary caregivers can delete custom activity types with the same cascade used by the Android app:

```ts
const customType = await baby.createActivityType({
  title: "Outdoor time",
  hasDuration: true,
});

const stroller = await baby.createGroup({
  title: "Stroller",
  daType: customType.uid,
});

console.log(await baby.listGroups(customType.uid));
await baby.deleteActivityType(customType.uid);
```

New custom types use the app's `pen_ink` icon, disabled optional fields, and one of its exact 80 hexadecimal color strings unless overridden. Group names are unique case-insensitively within each activity type and list in the app's activity-type/title order. Deleting a group tombstones only that group, matching the app.

Deleting a custom type updates both activity-type configuration records, then tombstones matching reminders, groups, activities, and the custom type in native order. Built-in activity types cannot be deleted.

All direct collection repositories provide `list`, `get`, `save`, `softDelete`, and `hardDelete`. Prefer `softDelete` because the mobile app uses tombstones to synchronize deletions.

Daily notes use the app's timezone-aware `yyyyMMdd` document IDs:

```ts
const day = new Date("2026-01-02T00:30:00Z");
await baby.setDailyNote("First full night", day, "America/Chicago");
console.log(await baby.getDailyNote(day, "America/Chicago"));
await baby.deleteDailyNote(day, "America/Chicago");
```

`setDailyNote("", ...)` deletes the note exactly like the app. Whitespace-only notes remain valid because the native check distinguishes an empty string from non-empty text.

## Teething chart

The SDK reproduces the app's complete primary-tooth model rather than exposing only raw Firestore records:

```ts
const chart = baby.listToothChart();
const map = await baby.getToothMap();

const upperLeftCentralId = toothUid("central_incisor", "upper", "left");
const upperCentralRange = getToothEruptionInterval("central_incisor", "upper");

const growth = await baby.createGrowth({ weight: 7.5 });
const moment = await baby.createMoment({ description: "First steps" });
const tooth = await baby.createTooth({ name: "central_incisor", jaw: "lower", side: "left" });

const momentMonths = await baby.listMomentMonths({ timeZone: "America/Chicago" });
const julyMoments = await baby.listMomentsForMonth(new Date("2026-07-15"), { timeZone: "America/Chicago" });
```

`listToothChartItems` returns the native ten-row eruption/shed order. `listPrimaryTeeth` and `baby.getToothMap()` return all 20 positions with deterministic IDs, native colors, expected age intervals, and `none`, `erupted`, or `shed` state. When both flags are present, `shed` takes precedence exactly like the app.

Growth, moment, and tooth helpers reproduce native editor defaults. Growth and moment records receive random IDs and current timestamps; tooth IDs are deterministic and a newly selected tooth starts as erupted. Every save or delete resets `svt` to zero and refreshes `updatedMillis` for cloud synchronization.

Moment month lists match the native screen's `date_millis DESC, uid` ordering and local-calendar grouping. Supplying `timeZone` makes month boundaries deterministic in server and CLI processes; range filters include the complete selected months, matching the Android query.

## Search and growth

```ts
const nightFeeds = await baby.searchActivities({
  query: "night",
  types: ["bottle", "breastfeeding"],
  reactions: ["liked"],
  parameters: ["pee"],
  offset: 0,
  limit: 25,
});
const activityCount = await baby.countSearchActivities({ query: "night" });
const matchingNotes = await baby.searchDailyNotes("doctor", {
  fromMillis: Date.parse("2026-01-01T00:00:00Z"),
  toMillis: Date.parse("2026-12-31T00:00:00Z"),
  limit: 25,
});
const noteCount = await baby.countSearchDailyNotes("doctor");

const growthEntries = await baby.listGrowth();
const comparisonBabies = await client.listGrowthComparisonBabies(baby.babyUid);
const comparisonGrowth = await client.getGrowthComparisonMap(comparisonBabies.map(({ uid }) => uid));

const result = calculateGrowthPercentile({
  source: "who_0_60_months",
  gender: "female",
  measurement: "weight",
  age: 12,
  value: 9.1,
});
```

Growth age uses the selected reference dataset's weeks, months, or years. Use `growthAgeAtDate` to convert timestamps and `calculateGrowthValueAtPercentile` to obtain a reference value for percentiles 1 through 99.

`baby.listGrowth()` matches the native list's `date_millis DESC` order. The chart comparison picker exposes only other babies with the active baby's gender, and `getGrowthComparisonMap()` fetches each selected baby's ordered series while preserving selection order.

Search reproduces the native SQLite screen behavior: activity keywords match notes only, reaction values are OR filters, selected `pee`, `poo`, and `hairWash` parameters are all required, and `groupsByType` applies the app's per-activity-type group map. Activities sort by `startMillis DESC, type, uid`; day notes sort by their `YYYYMMDD` ID descending. Count helpers intentionally ignore `offset` and `limit`, matching the app's separate count and paged-list queries.

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

const caregiver = await client.family.getUserWithPremiumStatus("caregiver@example.com");
if (caregiver) console.log(caregiver.user.displayName, caregiver.isPremium);

const caregiverScreen = await client.baby(babyUid).getCaregiversScreenData();
console.log(caregiverScreen.caregivers, caregiverScreen.pendingInvites);
```

Caregiver mutations follow the native app's `void` contract. Email lookup returns `undefined` when the cloud function reports that no user exists and validates successful user responses before exposing them.

`getCaregiversScreenData` joins the baby owner, accepted-invite user profiles, pending invites, current user, primary-caregiver state, and the native deleted-from-cloud state. The primary caregiver is always first; remaining caregivers and pending invitations use deterministic display-name/email ordering.

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

const relevant = await baby.getRelevantReminderSchedules();
await baby.dismissReminder(relevant[0].reminder.uid);
```

Create, edit, and delete reminders through the native editor lifecycle rather than writing raw documents:

```ts
const reminder = await baby.createReminder({
  daType: "bottle",
  groupUid: formulaGroupUid,
});

await baby.saveReminder({
  ...reminder,
  type: "advanced_repeat_weekdays",
  dateMillis: Date.now(),
  repeatWeekdays: "1,3,5",
});

await baby.deleteReminder(reminder.uid);
```

New basic reminders use the app's three-hour interval and native 16-character ID format. Saving clears fields that do not belong to the selected mode, resets dismissal, and enforces a minimum one-day interval for `advanced_repeat_days`. The relevant-reminder helper matches the home screen: expired reminders are always included, upcoming reminders enter the list strictly less than 30 minutes before their occurrence, and `getEarliestReminderDisplayMillis` returns the next time a caller should refresh. Dismissal stamps `dismissedMillis` and `updatedMillis` while resetting `svt` to zero for synchronization.

## Attachments and backups

```ts
await baby.uploadAttachment("moments", momentUid, "photo.jpg", jpegBytes, "image/jpeg");
await baby.uploadAttachmentThumbnail("moments", momentUid, "photo.jpg", thumbnailBytes, "image/jpeg");
const jpeg = await baby.downloadAttachment("moments", momentUid, "photo.jpg");
const preview = await baby.downloadAttachment("moments", momentUid, "photo.jpg", true);
await baby.deleteAttachment("moments", momentUid, "photo.jpg");

const backup = await baby.createBackup();
await baby.restoreBackup(backup);

// Same-account lightweight snapshot; existing Storage objects must remain available.
const metadataOnlyBackup = await baby.createBackup({ includeAttachments: false });
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

Version 2 backups embed every active original attachment as base64 by default, so restored image and video records do not point at missing Storage objects. Native `thumb_` preview files are not embedded because downloads already fall back to the original; applications can regenerate thumbnails after restore. Backup creation fails if an active metadata record points at a missing file rather than silently creating an incomplete archive. Use `includeAttachments: false` only for lightweight same-account snapshots where the original Firebase Storage objects will remain available.

The SDK backup is a portable JSON snapshot of baby data, per-caregiver reminders and settings, attachment metadata, and optional attachment contents. It intentionally excludes caregiver access-control relationships, caregiver profiles, and purchases. Baby Daybook's Android backup command instead copies the app's nine-table private SQLite database to a `.db` file; the two formats are intentionally not interchangeable.

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

The native Development tab derives its cards from existing growth, moment, and attachment records. The SDK exposes the same derived data:

```ts
const growthCard = await baby.getDevelopmentGrowth({
  weightUnit: "poundsAndOunces",
  lengthUnit: "inches",
});
const momentsCard = await baby.getDevelopmentMoments(3);
```

`getDevelopmentGrowth` keeps the newest growth record's identity and backfills each missing measurement from older records, matching the Android repository. `getDevelopmentMoments` counts all active moments, limits moments in `dateMillis DESC, uid` order, and then returns active preview-file metadata for that limited set.

The Home and Timeline screens use an overlap-aware range query. It includes ordinary activities whose start is inside the inclusive range, plus duration activities that began earlier and either end after the range starts or remain in progress:

```ts
const activities = await baby.listActivitiesForRange({
  fromMillis: dayStart,
  toMillis: dayEnd,
  types: ["sleeping", "bottle"],
});
const count = await baby.countActivitiesForRange({ fromMillis: dayStart, toMillis: dayEnd });
```

Results follow the native `startMillis DESC, type, uid` order. Duration types come from each activity type's `hasDuration` flag, including custom types.

The Home quick-launch strip is available as a composed read model:

```ts
const quickLaunch = await baby.getQuickLaunchItems({
  nowMillis: Date.now(),
  lastFeedingFromStart: true,
});
```

Each item contains its configured activity type, latest activity when present, and first relevant reminder schedule when present. Stored activity-type configuration order is preserved; unknown or deleted type IDs are skipped.

The Home day-summary cards are available with the native aggregation and ordering rules:

```ts
const cards = await baby.getDayActivityTypeSummaries({
  fromMillis: dayStartMillis,
  toMillis: dayEndMillis,
  nowMillis: Date.now(),
});
```

Each card includes count and overlap-scaled duration, left/right feeding or pumping totals, volume, diaper and bath counters, maximum temperature, amount totals by group and unit, the active timer, and the native last-side/group/unit values. Cards with recent activities come first; configured cards without records remain available afterward.

The Statistics screen selector and native tab eligibility are also available:

```ts
const statisticsScreen = await baby.getStatisticsScreenData(preferredActivityTypeUid);
```

It returns configured activity types with all-time active record counts and the exact native tab order: number of times, optional duration, temperature, volume, amount, reaction, then time of day. A missing preferred type falls back to the first configured type.

When reproducing the app's one-time profile conversion, use `migrateUnitsToMetric`. The callback must durably store the supplied metadata-only recovery backup before the SDK changes any record:

```ts
import { writeFile } from "node:fs/promises";

await baby.migrateUnitsToMetric({
  temperatureFahrenheit: true,
  volumeFluidOunces: true,
  growthWeightPoundsAndOunces: true,
  growthHeightInches: true,
  growthHeadSizeInches: true,
  persistBackup: (backup) => writeFile(
    "baby-daybook-pre-unit-conversion.json",
    JSON.stringify(backup, null, 2),
    { mode: 0o600 },
  ),
});
```

This follows the native backup-first order, converts only active nonzero values, preserves each converted activity or growth record's timestamp, resets its sync version, and marks the baby profile's `convertUnits` flag after the records succeed. If `persistBackup` rejects, no data is mutated.

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
