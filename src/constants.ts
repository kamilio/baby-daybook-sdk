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

export const BABY_DAYBOOK_ACTIVITY_TYPE_COLORS = Object.freeze([
  "#F06292", "#E23F7B", "#C51162", "#C2185B", "#A61057", "#BA68C8", "#9C27B0", "#AA00FF",
  "#7B1FA2", "#4A148C", "#9575CD", "#7355B5", "#6200EA", "#512DA8", "#311B92", "#7986CB",
  "#3F51B5", "#304FFE", "#303F9F", "#1A237E", "#64B5F6", "#2196F3", "#2962FF", "#3378C7",
  "#0D47A1", "#4FC3F7", "#24A7E7", "#0091EA", "#0288D1", "#01579B", "#4DD0E1", "#00BCD4",
  "#31ACBE", "#0097A7", "#006064", "#58C2AB", "#21978B", "#00BFA5", "#00796B", "#004D40",
  "#81C784", "#4CAF50", "#00C853", "#388E3C", "#1B5E20", "#AED581", "#81B239", "#64DD17",
  "#5C8B29", "#33691E", "#CDDC39", "#AEEA00", "#AFB42B", "#9E9D24", "#827717", "#FFD54F",
  "#F8BF01", "#FFAB00", "#FFA000", "#FF6F00", "#FFB74D", "#F69601", "#FF6D00", "#F57C00",
  "#E65100", "#FF7043", "#FF5722", "#E64A19", "#DD2C00", "#BF360C", "#E57373", "#F44336",
  "#D50000", "#D32F2F", "#B71C1C", "#C19C8F", "#9B7467", "#765547", "#AE8601", "#749E9C",
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
