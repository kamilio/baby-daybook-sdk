import type {
  ActivityGroup,
  ActivityType,
  BuiltInActivityType,
  DefaultActivityGroupDefinition,
  DefaultActivityGroupTitleResolver,
} from "./types.js";

interface DefaultActivityTypeDefinition {
  uid: BuiltInActivityType;
  color: string;
  icon: string;
  category: "" | "feeding" | "health";
  hasDuration: boolean;
  hasAmount: boolean;
  hasReaction: boolean;
}

export const DEFAULT_ACTIVITY_TYPE_DEFINITIONS: readonly Readonly<DefaultActivityTypeDefinition>[] = Object.freeze([
  { uid: "breastfeeding", color: "#E23F7B", icon: "bra", category: "feeding", hasDuration: true, hasAmount: false, hasReaction: false },
  { uid: "bottle", color: "#24A7E7", icon: "bottle", category: "feeding", hasDuration: false, hasAmount: false, hasReaction: false },
  { uid: "diaper_change", color: "#58C2AB", icon: "nappy", category: "", hasDuration: false, hasAmount: false, hasReaction: false },
  { uid: "sleeping", color: "#81B239", icon: "crib", category: "", hasDuration: true, hasAmount: false, hasReaction: false },
  { uid: "food", color: "#F69601", icon: "bib", category: "feeding", hasDuration: false, hasAmount: true, hasReaction: true },
  { uid: "pump", color: "#7355B5", icon: "pump", category: "", hasDuration: false, hasAmount: false, hasReaction: false },
  { uid: "drink", color: "#00BCD4", icon: "sippy_cup", category: "", hasDuration: false, hasAmount: false, hasReaction: false },
  { uid: "bath", color: "#3378C7", icon: "bath_bubbles", category: "", hasDuration: false, hasAmount: false, hasReaction: true },
  { uid: "potty", color: "#A61057", icon: "potty", category: "", hasDuration: false, hasAmount: false, hasReaction: false },
  { uid: "toothbrushing", color: "#AFB42B", icon: "toothbrush", category: "", hasDuration: false, hasAmount: false, hasReaction: false },
  { uid: "medicine", color: "#F44336", icon: "pill", category: "health", hasDuration: false, hasAmount: true, hasReaction: false },
  { uid: "temperature", color: "#B71C1C", icon: "thermometer", category: "health", hasDuration: false, hasAmount: false, hasReaction: false },
  { uid: "doctor_visit", color: "#E57373", icon: "stethoscope", category: "health", hasDuration: false, hasAmount: false, hasReaction: true },
  { uid: "vaccination", color: "#BA68C8", icon: "syringe", category: "health", hasDuration: false, hasAmount: false, hasReaction: false },
  { uid: "symptom", color: "#FF7043", icon: "symptom", category: "health", hasDuration: false, hasAmount: false, hasReaction: false },
  { uid: "crying", color: "#00796B", icon: "face_crying", category: "", hasDuration: true, hasAmount: false, hasReaction: false },
  { uid: "tummy_time", color: "#F8BF01", icon: "tummy_time", category: "", hasDuration: true, hasAmount: false, hasReaction: true },
  { uid: "walking_outside", color: "#749E9C", icon: "stroller", category: "", hasDuration: true, hasAmount: false, hasReaction: false },
  { uid: "playtime", color: "#AE8601", icon: "playground", category: "", hasDuration: true, hasAmount: false, hasReaction: false },
  { uid: "other", color: "#765547", icon: "pen_ink", category: "", hasDuration: false, hasAmount: true, hasReaction: true },
]);

export const DEFAULT_ACTIVITY_GROUP_DEFINITIONS: readonly Readonly<DefaultActivityGroupDefinition>[] = Object.freeze([
  { daType: "bottle", messageKey: "mothers_milk", title: "Mother’s milk" },
  { daType: "bottle", messageKey: "formula", title: "Formula" },
  { daType: "drink", messageKey: "juice", title: "Juice" },
  { daType: "drink", messageKey: "tea", title: "Tea" },
  { daType: "drink", messageKey: "water", title: "Water" },
  { daType: "food", messageKey: "cereal", title: "Cereal" },
  { daType: "food", messageKey: "fruit", title: "Fruit" },
  { daType: "food", messageKey: "meat", title: "Meat" },
  { daType: "food", messageKey: "snack", title: "Snack" },
  { daType: "food", messageKey: "veggies", title: "Veggies" },
  { daType: "medicine", messageKey: "antibiotics", title: "Antibiotics" },
  { daType: "medicine", messageKey: "paracetamol", title: "Paracetamol" },
  { daType: "medicine", messageKey: "ibuprofen", title: "Ibuprofen" },
  { daType: "medicine", messageKey: "multivitamins", title: "Multivitamins" },
  { daType: "medicine", messageKey: "vitamin_d", title: "Vitamin D" },
  { daType: "medicine", messageKey: "fish_oil", title: "Fish oil" },
  { daType: "vaccination", messageKey: "vaccine_var", title: "Chickenpox (Var)" },
  { daType: "vaccination", messageKey: "vaccine_bcg", title: "Tuberculosis (BCG)" },
  { daType: "vaccination", messageKey: "vaccine_dtap", title: "Diphtheria, tetanus, and whooping cough (DTaP)" },
  { daType: "vaccination", messageKey: "vaccine_hib", title: "Haemophilus influenzae type b (Hib)" },
  { daType: "vaccination", messageKey: "vaccine_hepa", title: "Hepatitis A (HepA)" },
  { daType: "vaccination", messageKey: "vaccine_hepb", title: "Hepatitis B (HepB)" },
  { daType: "vaccination", messageKey: "vaccine_flu", title: "Influenza (Flu)" },
  { daType: "vaccination", messageKey: "vaccine_mmr", title: "Measles, mumps, rubella (MMR)" },
  { daType: "vaccination", messageKey: "vaccine_menb", title: "Meningococcal (MenB)" },
  { daType: "vaccination", messageKey: "vaccine_pcv", title: "Pneumococcal (PCV)" },
  { daType: "vaccination", messageKey: "vaccine_ipv", title: "Polio (IPV)" },
  { daType: "vaccination", messageKey: "vaccine_rv", title: "Rotavirus (RV)" },
  { daType: "symptom", messageKey: "irritability", title: "Irritability" },
  { daType: "symptom", messageKey: "fever", title: "Fever" },
  { daType: "symptom", messageKey: "rash", title: "Rash" },
  { daType: "symptom", messageKey: "vomiting", title: "Vomiting" },
  { daType: "symptom", messageKey: "diarrhea", title: "Diarrhea" },
  { daType: "symptom", messageKey: "breathing_problems", title: "Breathing problems" },
  { daType: "symptom", messageKey: "stuffy_nose", title: "Stuffy nose" },
  { daType: "symptom", messageKey: "runny_nose", title: "Runny nose" },
  { daType: "symptom", messageKey: "sneezing", title: "Sneezing" },
  { daType: "symptom", messageKey: "coughing", title: "Coughing" },
  { daType: "symptom", messageKey: "decreased_appetite", title: "Decreased appetite" },
]);

export function createDefaultActivityTypes(babyUid: string, updatedMillis: number): ActivityType[] {
  return DEFAULT_ACTIVITY_TYPE_DEFINITIONS.map((definition) => ({
    ...definition,
    babyUid,
    userUid: "",
    updatedMillis,
    title: "",
  }));
}

export function createDefaultActivityGroups(
  babyUid: string,
  updatedMillis: number,
  resolveTitle: DefaultActivityGroupTitleResolver = ({ title }) => title,
): ActivityGroup[] {
  return DEFAULT_ACTIVITY_GROUP_DEFINITIONS.map((definition) => ({
    uid: randomNativeUid(),
    babyUid,
    userUid: "",
    updatedMillis,
    title: resolveTitle(definition),
    description: "",
    daType: definition.daType,
  }));
}

function randomNativeUid(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  while (result.length < 16) {
    const bytes = crypto.getRandomValues(new Uint8Array(16 - result.length));
    for (const byte of bytes) {
      if (byte >= 248) continue;
      result += alphabet[byte % alphabet.length];
    }
  }
  return result;
}
