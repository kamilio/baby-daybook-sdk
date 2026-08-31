# Baby Daybook SDK, CLI, and MCP Servers

Unofficial, typed JavaScript SDK plus a Toolcraft CLI and stdio/Streamable HTTP MCP servers for accessing a user's Baby Daybook data through the same Firebase services used by the Android app. It is not affiliated with Baby Daybook or DrillyApps.

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
- Native count-chart cards for total, average per day, and average time between activities, including comparison percentages and the app's five-minute interval cutoff.
- Native volume-chart period bins and total, average-per-day, and average-per-activity cards with adjacent-range comparisons.
- Native amount-chart period bins and cards kept separate by the app's exact amount-unit strings.
- Native duration-chart period totals and average-per-day summaries, preferring stored pause-adjusted durations and safely handling unfinished activities.
- Native temperature scatter points, per-period extrema and averages, and the app's highest-period-average summary rule.
- Native liked/neutral/disliked reaction distributions and the app's liked-count comparison summary.
- Native 24-hour time-of-day count distributions with optional previous-range comparison series.
- App-compatible reminder scheduling for one-time, activity-relative, day-interval, and weekday reminders, including DND and dismissal handling.
- Baby Daybook sleep recommendations for newborns through 59 months, including grouped age ranges.
- Native-compatible average sleep clock ranges, including crossing-midnight normalization.
- Native sleep-duration constraint loosening and clamping used by prediction adjustments.
- The native 20-position primary-tooth map, ten-row eruption/shed chart, deterministic tooth IDs, colors, and state precedence.
- Raw Firestore, Firebase Storage, and callable-function clients for forward-compatible access.
- A workflow-oriented 79-command Toolcraft tree exposed identically through a typed SDK, the `baby-daybook` CLI, and MCP servers.

The SDK does not bypass subscription checks. Operations remain subject to the authenticated user's Firebase security-rule permissions and Baby Daybook account status.

The default Firebase configuration includes the Android package name and release-certificate SHA-1 extracted from Baby Daybook 7.0.8. Authentication and token-refresh requests send both values in Google's required `X-Android-Package` and `X-Android-Cert` headers because the app's API key rejects unidentified clients. Custom Firebase configurations can override both fields.

## Install

```bash
npm install @kamilio/baby-daybook-sdk
```

To install the CLI globally from npm:

```bash
npm install -g @kamilio/baby-daybook-sdk
baby-daybook --help
```

## CLI

The CLI uses the persisted rotating refresh-token session at `~/.config/baby-daybook/auth.json` by default. Create or refresh it with automatic Apple login, or authenticate through environment variables:

```bash
export BABY_DAYBOOK_EMAIL="parent@example.com"
export BABY_DAYBOOK_PASSWORD="your-linked-password"

baby-daybook login apple
baby-daybook manage account status
baby-daybook babies list
baby-daybook log bottle 5 --volume-unit fluidOunces
baby-daybook log diaper wet-and-dirty
baby-daybook timeline recent
baby-daybook timeline timer start BABY_UID sleeping
baby-daybook journal growth add BABY_UID --weight 8.2 --height 70
baby-daybook journal notes set BABY_UID "Slept well"
baby-daybook sleep predict BABY_UID
baby-daybook sleep statistics BABY_UID --interval last7Days
```

`baby-daybook login apple` opens a temporary Chrome, Edge, or Chromium profile and captures Baby Daybook's native callback automatically. It never asks you to paste the callback. Use `--browser`, `--auth-file`, or `--timeout-minutes` to override the browser executable, session location, or 30-minute timeout. The login command requires Node.js 22 or newer; the remaining SDK, CLI, and MCP features support Node.js 20 or newer.

Use `BABY_DAYBOOK_REFRESH_TOKEN` for an explicit refresh token or `BABY_DAYBOOK_AUTH_FILE` for another session path. Email and password must always be provided together. A successful token rotation is atomically persisted in the versioned session format with directory mode `0700` and file mode `0600`.

Destructive commands require confirmation. For reviewed automation, pass `--yes`:

```bash
baby-daybook timeline delete BABY_UID ACTIVITY_UID --yes
baby-daybook manage caregivers remove BABY_UID CAREGIVER_UID --yes
```

Use `--output json` for scripts and agents. Run group or command help to inspect exact parameters:

```bash
baby-daybook timeline --help
baby-daybook timeline timer start --help
```

## MCP server

Start the same command tree as an MCP stdio server:

```bash
baby-daybook mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "baby-daybook": {
      "command": "baby-daybook",
      "args": ["mcp"],
      "env": {
        "BABY_DAYBOOK_AUTH_FILE": "/home/user/.config/baby-daybook/auth.json"
      }
    }
  }
}
```

MCP exposes a flat `tools/list`, so all 79 tools remain visible. Nested command groups become name prefixes such as `log__bottle`, `timeline__timer__start`, and `advanced__backup__create`; the redundant root prefix is omitted. Every tool publishes input and output schemas plus explicit read-only, destructive, idempotent, and open-world annotations. The dedicated `log` tools use a precise activity output schema; other data commands return JSON-compatible results under `data`.

## Streamable HTTP MCP server

Run the identical 79-tool tree over Streamable HTTP:

```bash
baby-daybook http
```

The secure defaults bind to `127.0.0.1`, select a free operating-system port, and expose `/mcp`. The listening URL is printed to standard error. For a fixed local endpoint:

```bash
baby-daybook http --port 8080 --path /mcp --allowed-host localhost:8080
```

The CLI defaults to Toolcraft's stateless mode; pass `--stateful` to create persistent sessions with random UUIDs. Use `baby-daybook http --help` for JSON responses, host/origin allowlists, request limits, session limits, concurrency, proxy handling, and timeout controls. OAuth, observability, custom session stores, request-scoped services, and the complete upstream transport options are available through the ESM-only programmatic export:

```ts
import { runBabyDaybookHTTPMCP } from "@kamilio/baby-daybook-sdk/toolcraft-http";

const handle = await runBabyDaybookHTTPMCP({
  hostname: "127.0.0.1",
  port: 8080,
  path: "/mcp",
  oauth,
  requestServices: ({ auth }) => ({
    babyDaybook: serviceForSubject(auth?.subject),
  }),
});

console.log(handle.url);
```

The HTTP surface requires Node.js 20 or newer. Toolcraft owns the HTTP adapter and bundles `tiny-http-mcp-server`; consumers do not install or wire the transport separately.

### Public OAuth MCP service

The repository also deploys the same tool tree as a public, multi-user OAuth MCP service:

```text
https://baby-daybook-kjopek.fly.dev/mcp
```

Connect that URL from an OAuth-capable MCP client. The client discovers protected-resource and authorization-server metadata, dynamically registers, and starts authorization code with PKCE. The hosted interaction offers Sign in with Apple using a one-time `intent://callback…` paste-back step and an email/password option for accounts that already have password sign-in enabled. Each OAuth subject receives a separate encrypted Baby Daybook refresh token; there is no shared account, static service token, or anonymous fallback.

After a successful Apple or email reconnection, the next tool request loads the replacement Baby Daybook session without a server restart. Late refresh or sign-out callbacks from an older client cannot overwrite or remove that replacement, and an older failed request cannot evict the new cached client. A cached-session refresh failure discards that client but retains persisted sign-in state for recovery. Already-running tool operations are not automatically cancelled or replayed.

Maintainers deploy the bundled Node.js 24 OAuth server from this repository's `Dockerfile` and `fly.toml`.

The Garmin relay combines complementary legacy wet/dirty diaper events within one minute. New merges persist the consumed watch event IDs in `garminMergedEventIds` on the combined record, in the same write as the merge. Retrying either the merged event or its full original batch does not create another diaper or rewrite that record. Soft-deleted records retain their replay identity. Records merged before this change have no saved incoming event ID; existing duplicates are not automatically repaired. This behavior does not change replay handling for other activity types or explicit activity edits.

The deployment uses Toolcraft's supported authorization server, SQLite on a persistent Fly volume, AES-256-GCM session encryption, ES256 access tokens, PKCE S256, exact redirect URIs, token rotation with replay revocation, secure interaction cookies, request limits, and rate limits.

## Toolcraft SDK

The regular package root remains the dual ESM/CommonJS low-level typed Baby Daybook SDK. The ESM-only `baby-daybook-sdk/toolcraft` export provides the shared command tree and generated in-process SDK:

```ts
import { createBabyDaybookToolcraftSDK } from "@kamilio/baby-daybook-sdk/toolcraft";

const tools = createBabyDaybookToolcraftSDK({
  env: {
    BABY_DAYBOOK_AUTH_FILE: `${process.env.HOME}/.config/baby-daybook/auth.json`,
  },
});

const babies = await tools.babies.list({ includeDeleted: false });
const prediction = await tools.sleep.predict({ babyUid: babies.data[0].uid });
const bottle = await tools.log.bottle({ volume: 5, volumeUnit: "fluidOunces" });
```

All Toolcraft commands have `cli`, `mcp`, and `sdk` scope, preserving exact command parity across the three surfaces. The adapters share one handler implementation, so validation, authentication, and returned data do not drift. The CLI requires `--yes` for reviewed destructive actions, while MCP clients receive the corresponding destructive annotations.

The command hierarchy is intentionally task-first:

- `log` — pump, bottle, diaper, medicine, and another completed point activity.
- `timeline`, `sleep`, `journal`, `reminders`, and `insights` — everyday reads and care workflows.
- `manage` — account, baby-profile, caregiver, activity-type, group, and setting administration.
- `reports` — CSV and PDF exports.
- `advanced` — raw JSON patches, attachments, backups, and synchronization internals.

MCP has no collapsible group hierarchy: `manage` and `advanced` lower administrative tools' prominence through clear name prefixes, but do not hide them. This is intentional so CLI, MCP, and SDK expose the same 79 commands.

## Sign in

```ts
import { BabyDaybookClient } from "@kamilio/baby-daybook-sdk";

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
import { calculateAverageSleepRange } from "@kamilio/baby-daybook-sdk";

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
await client.setPassword(replacementPassword); // Later rotation on the authenticated account.
```

This keeps the existing Firebase user ID, babies, and activity data, while adding email/password as another sign-in method. Do not use `signUpWithEmail` for this migration: it can create a separate Firebase user. Apple remains linked, and subsequent CLI runs can use `signInWithEmail` or the persisted refresh token. If Apple supplied a private-relay address, confirm which email you want associated with the account before linking it.

The repository includes a one-time headed-browser command that performs this migration without asking for an Apple password in the terminal:

```bash
baby-daybook login apple
```

The command opens a temporary Chrome, Edge, or Chromium profile, lets Apple handle credentials and two-factor authentication, captures Baby Daybook's native direct or redirected `intent://` callback through the browser debugging protocol (including Chrome's insecure-form interstitial without requiring its confirmation button), signs into the existing Firebase user, asks which email to link, generates a 192-bit URL-safe password, and requests email verification. It stores only the rotating Firebase refresh token in `~/.config/baby-daybook/auth.json`; the directory is created with mode `0700` and the file with mode `0600`. Save the generated password in your password manager because it is displayed once and is not written to that file. Use `--email`, `--browser`, `--auth-file`, or `--timeout-minutes` to override the interactive email, browser executable, session location, or 30-minute browser timeout.

An Apple app-specific password is not interchangeable with a Baby Daybook password and will not work with Firebase email/password authentication. The password must be linked after a successful Apple session, as the command does. To restore the saved session later:

```bash
baby-daybook manage account status
```

This health check refreshes and safely re-persists the rotating session when needed, verifies that Firebase and the active SDK session identify the same account, reports whether email/password is linked, and prints only the number of accessible babies. Pass `--auth-file path` after `--` when using a non-default session file.

```ts
import { readFile } from "node:fs/promises";
import { BabyDaybookClient } from "@kamilio/baby-daybook-sdk";

const saved = JSON.parse(await readFile(`${process.env.HOME}/.config/baby-daybook/auth.json`, "utf8"));
const client = await BabyDaybookClient.fromRefreshToken(saved.refreshToken);
```

For a custom browser integration, `createAppleAuthorizationUrl()` recreates the native Android request, `parseAppleCallbackUrl()` validates the returned `intent://callback` credential, and `BabyDaybookClient.signInWithAppleCallback()` completes the Firebase exchange.

Account lifecycle mirrors the mobile app. Display-name changes update both Firebase Authentication and the Baby Daybook user document, while sign-out invalidates the local SDK session and emits `undefined` through `onSessionChanged`:

```ts
await client.updateDisplayName("Parent name");
await client.signOut();
```

Creating a baby also initializes the same 20 built-in activity types and 39 default groups as the Android app. It follows the native write order: create the baby first, then write the default activity types and groups. The ownership relation is server-managed and read-only to clients. If default initialization fails, the SDK rolls back the newly created baby root:

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

await client.baby(created.uid).delete();
```

Baby profile saves match the native editor: the name must contain at least one character, all entered profile fields are preserved without hidden birthday or premature-birth normalization, and each save writes `svt: 0` with a fresh `updatedMillis` synchronization stamp. Baby deletion is a synchronization tombstone rather than a Firestore hard delete, matching the app and its security rules.

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

Stopping a paused timer records its pause boundary as `endMillis` and excludes the paused tail from `duration`, sleep charts, and timeline overlap. An explicitly earlier stop time is still honored. `updatedMillis` records the completion write time; a resumed timer uses its requested stop time with the existing pause-adjusted start.

Repeating Pause on an already-paused activity or Stop on a completed activity returns the stored record without another write, even when a different timestamp is supplied. Pausing a completed activity fails without changing history. Stop timestamps apply only when completing a running or paused timer; to correct completed history, use `saveActivity` or `sdk.advanced.raw.activities.update` with the intended `endMillis` and `duration`. These checks use the persisted state and do not make concurrent transitions atomic.

Stopping a breastfeeding or pumping timer saves its final left/right segment together with the completion fields in one write, preserving previously accumulated side durations. A paused side is settled only through its pause time; selecting `both` credits the remaining segment to both side counters. Daily feeding and pumping summaries expose these values as `leftDurationMillis` and `rightDurationMillis`, rather than the generic `durationMillis` field.

Completed point events have dedicated methods and never create an active timer:

```ts
await baby.logPump({ volume: 135, side: "both" });
await baby.logBottle({ volume: 150, groupUid: formulaGroupUid });
await baby.logDiaper({ pee: true, poo: true });
await baby.logMedicine({ amount: 1, amountUnit: "drops", groupUid: vitaminDGroupUid });
```

The Toolcraft `log` façade adds single-baby auto-selection, exact baby-name lookup, fluid-ounce conversion, and safe group-title resolution. Native records keep canonical milliliters and integer `0/1` flags at the Firestore boundary while SDK callers receive booleans.

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

Growth PDFs treat zero and negative measurement placeholders as absent, matching the development summary's positive-value rule. Each measurement is handled independently: missing values leave blank table cells and do not affect that measurement's trend count, minimum, maximum, or latest value and date. Dated records, notes, and valid measurements in the same row remain included; exports do not modify stored records. This rule applies before metric or imperial conversion.

Activity PDF rows use the recorded volume in milliliters for bottle, pump, and drink activities, rather than their native zero-valued amount placeholder. Temperature activities show their recorded Celsius value with an ASCII `C` unit label. Other activity types retain their recorded amount and amount unit. Missing quantities stay blank, and exporting does not change stored records.

Activity CSV exports append `temperature` and `temperatureUnit` after the existing columns, preserving their order. Temperature readings stay numeric in canonical Celsius with `temperatureUnit` set to `celsius`; both cells stay blank for other activity types or an absent reading. CSV and PDF retain stored precision and explicit zero readings without converting units or interpreting the measurement. Native temperature defaults on unrelated activity types are not exported as readings.

Daily notes in activity PDFs wrap to the page's printable width using the rendered font's character advances. Explicit line endings, blank paragraphs, indentation, and complete words are preserved; tabs expand to four spaces. Unbroken text wider than a line is split without truncation. Pagination counts the wrapped physical lines, so long notes continue onto subsequent pages without hiding their ending or overwriting page footers. Exporting leaves the stored note unchanged.

All three PDF modes preserve Unicode names, titles, and notes using embedded, subsetted Noto fonts with searchable/copyable text. Bundled fonts cover Latin accents, Greek, Cyrillic, Arabic, Hebrew, major South and Southeast Asian scripts, Chinese, Japanese, Korean, and monochrome emoji. Mixed right-to-left text and combining sequences are shaped before rendering. Table-field length limits count whole grapheme clusters, so shortening a field cannot split an accent or emoji sequence. Wide Unicode rows scale to fit the page; daily notes wrap without truncation. ASCII-only reports retain the compact Helvetica format, and the pure export functions remain synchronous. No font downloads or system fonts are needed at runtime. Characters outside the bundled fonts' coverage produce an explicit error naming their Unicode code points instead of silent replacement; CSV remains available for that text.

Keep `data/pdf-fonts` alongside `dist` when manually copying a built SDK or server. The npm package and Docker image include these assets and their SIL Open Font License notices. From a source checkout, `node scripts/update-pdf-fonts.mjs` reproduces the pinned upstream font assets and coverage manifest.

Reports retain their left-to-right column layout. Unicode table cells include direction-isolation marks so right-to-left labels and notes cannot reorder adjacent dates or numeric values; copied table text can retain these invisible formatting marks.

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

Day-interval and weekday recurrences use the host process's local time zone and the clock encoded in the stored `dateMillis`, including seconds and milliseconds. Each candidate date is reconstructed independently, so crossing a daylight-saving gap cannot shift later reminders or revive dismissed occurrences during backward scans. A nonexistent local time advances by the size of that date's clock gap; an ambiguous repeated time uses the earlier offset, following JavaScript `Date` resolution. This adjustment applies only to that occurrence, not to other dates or the stored reminder. One-time timestamps and activity-relative elapsed intervals are unchanged.

## Attachments and backups

```ts
import { randomUUID } from "node:crypto";

const fileName = `${randomUUID()}.jpg`;
await baby.uploadAttachment("moments", momentUid, fileName, jpegBytes, "image/jpeg");
await baby.uploadAttachmentThumbnail("moments", momentUid, fileName, thumbnailBytes, "image/jpeg");
const jpeg = await baby.downloadAttachment("moments", momentUid, fileName);
const preview = await baby.downloadAttachment("moments", momentUid, fileName, true);
await baby.deleteAttachment("moments", momentUid, fileName);

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

Activity statistics and `insights.activities` include temperature aggregates only from `temperature` activities with a defined temperature value. Native zero defaults and stray temperature fields on bottles or other activity types do not count as measurements. Ordinary activity counts, volumes, and other dimensions are unchanged. Explicit zero values on temperature activities remain included, consistent with the type-specific temperature chart; native record defaults are not rewritten.

`buildActivityStatistics`, `baby.getActivityStatistics(...)`, and `insights.activities` split sleep using local calendar boundaries in the process timezone (06:00–18:00 by default), including across daylight-saving changes. Custom `daytimeStartMinutes`/`daytimeEndMinutes` on the statistics APIs are local clock minutes, not elapsed offsets from midnight; `1440` means the next local midnight. Durations and daytime capacity for awake-time calculations use actual elapsed milliseconds, so windows spanning a clock change can be shorter or longer. JavaScript resolves skipped boundary times forward by the gap and repeated times to their earlier occurrence; a normalized window whose end is not after its start has zero capacity. Daily rows retain their existing activity-start-date attribution, and nap counts retain the existing daytime-at-least-nighttime rule. These split statistics are distinct from the native whole-session sleep charts described below.

The native app stores attachments under generated UUID image filenames. Firebase Storage triggers create and tombstone the corresponding Firestore file metadata; those metadata collections are read-only to clients, and the SDK never attempts forbidden direct writes. Metadata propagation is asynchronous, so callers that immediately create a backup after uploading should poll `baby.fileMetadata(category).list()` until the new file appears.

Version 2 backups embed every active original attachment as base64 by default, so restored image and video records do not point at missing Storage objects. Native `thumb_` preview files are not embedded because downloads already fall back to the original; applications can regenerate thumbnails after restore. Backup creation fails if an active metadata record points at a missing file rather than silently creating an incomplete archive. Use `includeAttachments: false` only for lightweight same-account snapshots where the original Firebase Storage objects will remain available.

The SDK backup is a portable JSON snapshot of baby data, per-caregiver reminders and settings, attachment metadata, and optional attachment contents. It intentionally excludes caregiver access-control relationships, caregiver profiles, and purchases. Baby Daybook's Android backup command instead copies the app's nine-table private SQLite database to a `.db` file; the two formats are intentionally not interchangeable.

`restoreBackup` still resolves to `undefined` on success. It restores attachments sequentially, then the baby profile, then the nine record sections concurrently. If any record save fails, it waits for every started save and readback to settle before rejecting; a failed restore no longer leaves sibling SDK promises writing behind the caller's recovery work. A prerequisite failure does not start later stages.

Write-stage failures throw `BabyDaybookRestoreError` (a `BabyDaybookError` with code `BACKUP_RESTORE_FAILED`). Its `outcomes` lists each target and its `fulfilled`, `rejected`, or `not-started` status. Targets identify the backup section and record UID, or the attachment category, item UID, and filename. Rejected outcomes retain the original `reason`; `errors` contains all those reasons and `cause` is the first in report order. Format and attachment-manifest validation errors still reject before writes begin.

```ts
import { BabyDaybookRestoreError } from "@kamilio/baby-daybook-sdk";

try {
  await baby.restoreBackup(backup);
} catch (error) {
  if (error instanceof BabyDaybookRestoreError) console.error(error.outcomes);
  throw error;
}
```

Restore is not transactional: completed writes are not rolled back. A rejected operation may have committed remotely before a response or readback failed, so its status does not prove that nothing was written. Settling SDK promises cannot cancel work the server may still perform after a transport failure. Inspect the affected targets and reconcile uncertain outcomes before retrying; do not blindly rerun an old backup over newer corrections. Await the restore before beginning recovery.

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
} from "@kamilio/baby-daybook-sdk";

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

Baby Daybook intentionally stores an empty `title` for built-in activity types because the native app localizes them from their stable UID. Composed read models expose `activityType.displayTitle` for rendering; the activity-type CLI/MCP list does the same. Raw repositories, synchronization, and backups keep the native `title` unchanged. Use `resolveActivityTypeDisplayTitle(activityType)` when presenting a raw activity type, and do not persist the derived display title.

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

`buildStatisticsParameterBreakdown` and `baby.getStatisticsParameterBreakdown(...)` reproduce the native parameter cards that appear within those tabs: left/right for breastfeeding and pumping, pee/poo/combined/empty for potty, wet/dirty/combined/dry for diaper changes, and hair-wash/no-hair-wash for baths. Each parameter includes date-period count, duration, and volume series, a 24-hour distribution, totals, and optional comparison-period series. This also covers the native volume-by-side card. Left and right duration charts use their dedicated side durations while side `both` contributes to both parameter series.

`buildStatisticsVolumeByHour` reproduces the native hourly volume card. It returns all 24 local hours with total volume, activity count, and the app's displayed average volume per activity, plus an optional comparison series and percentage change.

`buildStatisticsGroupBreakdown` and `baby.getStatisticsGroupBreakdown(...)` reproduce the native by-group cards across number of times, duration, volume, amount, reaction, and time of day. The baby-scoped method preserves the app's configured group order and includes groups with no data; each group carries period series, totals, amount-unit series, reaction distribution, hourly counts, and optional comparison series.

`buildStatisticsNapCountData` and `baby.getStatisticsNapCountData(...)` reproduce the native naps-number-of-times chart and average-per-day card. A sleep counts as a nap only when its complete range belongs to the configured local daytime window; sleeps crossing either daytime boundary remain nighttime sleep.

`buildStatisticsSleepDurationData` and `baby.getStatisticsSleepDurationData(...)` reproduce the native total, daytime, nighttime, nap-duration, awake-time, and average wake-up/bedtime cards. Sleep sessions are classified whole rather than split at daytime boundaries. Total, daytime, and nighttime series include totals and per-day averages; nap-duration series contain the average completed nap duration per chart period and overall. Awake-time bins average gaps of at least five minutes within each day before period aggregation. Wake-up and bedtime retain the app's native decimal-hour conversion, including its `minute / 59` behavior.

Native Statistics date presets and previous/next navigation are available too. Ranges use local calendar days, matching the app across daylight-saving changes:

```ts
const navigation = await baby.getStatisticsDateRange("last7Days");
// navigation.range, navigation.canLoadPrevious, navigation.canLoadNext

const previousRange = getPreviousStatisticsDateRange(navigation.range);
const nextRange = getNextStatisticsDateRange(navigation.range);

const chartPeriod = getStatisticsChartPeriod(navigation.range);
const queryRange = getStatisticsQueryDateRange(navigation.range, true);
const countBins = buildStatisticsActivityCountBins(activities, navigation.range, "bottle");
```

Chart periods and comparison queries use the native thresholds and adjacent equal-length range. Comparison is automatically unavailable for year charts.

When reproducing the app's one-time profile conversion, use `migrateUnitsToMetric`. The callback must durably store the supplied metadata-only recovery backup before the SDK changes any record:

```ts
import { readFile, writeFile } from "node:fs/promises";

const backupPath = "baby-daybook-pre-unit-conversion.json";

await baby.migrateUnitsToMetric({
  temperatureFahrenheit: true,
  volumeFluidOunces: true,
  growthWeightPoundsAndOunces: true,
  growthHeightInches: true,
  growthHeadSizeInches: true,
  loadBackup: async () => {
    try {
      return JSON.parse(await readFile(backupPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  persistBackup: (backup) => writeFile(
    backupPath,
    JSON.stringify(backup, null, 2),
    { mode: 0o600, flag: "wx" },
  ),
});
```

`loadBackup` is required, including for callers upgrading from the earlier write-only callback API. A missing reader rejects before any backup or record is written. Return `undefined` only when no migration backup exists. `persistBackup` must durably create the original backup without replacing an existing file; use a separate recovery file per baby and retain it after failures. The SDK records the source-unit options in that backup and refuses a different baby, changed options, invalid source values, or an unmarked older backup. Review older backups manually rather than guessing their units or overwriting them.

Retries reload the same original snapshot, including after a process restart. Records already equal to their metric targets are skipped, and a completed profile makes a retry a no-op. Only active nonzero measurements are converted; timestamps and unrelated fields are preserved. Each write checks the document's Firestore update time, so a racing edit rejects instead of being overwritten. Deleted records are not recreated. Conversion counts describe writes performed by the current invocation, not all earlier attempts.

Pause other apps and automations that write measurements until the migration finishes. The SDK checks for conflicting values and new records outside the source snapshot, but it does not lock other applications. If it reports a conflict, retain the original backup and reconcile the affected records before retrying; do not create a replacement backup from a partially converted dataset. The baby's `convertUnits` flag is set only after the current records are checked again. If loading or persisting the original backup fails, no unit data is mutated.

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
npm run build
npm test
npm run typecheck
npm run lint
```

Tests use mocked Firebase protocol responses and never access a real account. The repository does not run destructive live-account checks automatically; any manual verification with owner-provided credentials should use a dedicated test baby.
