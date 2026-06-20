import type { BabyDaybookConfig } from "./types.js";

export const BABY_DAYBOOK_CONFIG: Readonly<BabyDaybookConfig> = Object.freeze({
  apiKey: "AIzaSyDIjjUS-7888pKeaVgNM1g2lSLOX4i6Na8",
  appId: "1:219982030553:android:588c78aad27bc244",
  projectId: "baby-daybook-app",
  storageBucket: "baby-daybook-app.appspot.com",
  functionsRegion: "us-central1",
});

export const BUILT_IN_ACTIVITY_TYPES = Object.freeze([
  "breastfeeding",
  "bottle",
  "diaper_change",
  "sleeping",
  "food",
  "pump",
  "drink",
  "bath",
  "potty",
  "toothbrushing",
  "medicine",
  "temperature",
  "doctor_visit",
  "vaccination",
  "symptom",
  "crying",
  "tummy_time",
  "walking_outside",
  "playtime",
  "other",
] as const);

export const BABY_DATA_COLLECTIONS = Object.freeze([
  "daTypes",
  "dailyActions",
  "groups",
  "growth",
  "moments",
  "dailyNotes",
  "teething",
] as const);
