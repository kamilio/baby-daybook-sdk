import type { AttachmentCategory, BabyCollectionName } from "./types.js";

export const paths = {
  user: (userUid: string) => `userData/${userUid}`,
  userAcceptedInvites: (userUid: string) => `userData/${userUid}/acceptedInvites`,
  userCreatedBabies: (userUid: string) => `userData/${userUid}/createdBabies`,
  userPendingInvites: (userUid: string) => `userData/${userUid}/pendingBabies`,
  purchases: (userUid: string) => `userData/${userUid}/purchases`,
  baby: (babyUid: string) => `babyData/${babyUid}`,
  babyCollection: (babyUid: string, collection: BabyCollectionName) => `babyData/${babyUid}/${collection}`,
  babyAcceptedInvites: (babyUid: string) => `babyData/${babyUid}/acceptedInvites`,
  babyPendingInvites: (babyUid: string) => `babyData/${babyUid}/pendingInvites`,
  reminders: (userUid: string, babyUid: string) => `userData/${userUid}/babiesReminders/babyUid_${babyUid}/reminders`,
  settings: (userUid: string, babyUid: string) => `userData/${userUid}/babiesSettings/babyUid_${babyUid}/settings`,
  fileMetadata: (babyUid: string, category: AttachmentCategory) => `babyData/${babyUid}/${category}Files`,
} as const;
