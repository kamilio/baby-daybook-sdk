import { BabyDaybookApiError } from "./errors.js";
import { jsonHeaders, requestJson } from "./http.js";
import type { AuthSession } from "./auth.js";
import type { CaregiverInfo, User } from "./types.js";

export type BabyDaybookCloudFunction =
  | "changePrimaryCaregiver"
  | "acceptPendingInvite"
  | "declinePendingInvite"
  | "removeSelfFromCaregivers"
  | "removeAcceptedInvite"
  | "sendPendingInvite"
  | "cancelPendingInvite"
  | "getUserWithPremiumStatusByEmail"
  | "deleteUserAccount";

export interface BabyDaybookCloudFunctionData {
  changePrimaryCaregiver: { babyUid: string; newUserUid: string };
  acceptPendingInvite: { babyUid: string };
  declinePendingInvite: { babyUid: string };
  removeSelfFromCaregivers: { babyUid: string };
  removeAcceptedInvite: { babyUid: string; caregiverUid: string };
  sendPendingInvite: { babyUid: string; caregiverEmail: string };
  cancelPendingInvite: { babyUid: string; caregiverEmail: string };
  getUserWithPremiumStatusByEmail: { email: string };
  deleteUserAccount: Record<string, never>;
}

export interface BabyDaybookCloudFunctionResults {
  changePrimaryCaregiver: unknown;
  acceptPendingInvite: unknown;
  declinePendingInvite: unknown;
  removeSelfFromCaregivers: unknown;
  removeAcceptedInvite: unknown;
  sendPendingInvite: unknown;
  cancelPendingInvite: unknown;
  getUserWithPremiumStatusByEmail: CaregiverLookupResult;
  deleteUserAccount: unknown;
}

interface CaregiverLookupResult {
  success: boolean;
  user?: unknown;
  isPremium?: unknown;
}

export class CallableFunctionsClient {
  readonly session: AuthSession;

  constructor(session: AuthSession) {
    this.session = session;
  }

  async call<Name extends BabyDaybookCloudFunction>(
    name: Name,
    data: BabyDaybookCloudFunctionData[Name] = {} as BabyDaybookCloudFunctionData[Name],
  ): Promise<BabyDaybookCloudFunctionResults[Name]> {
    const { projectId, functionsRegion } = this.session.config;
    const response = await requestJson<{
      result?: BabyDaybookCloudFunctionResults[Name];
      data?: BabyDaybookCloudFunctionResults[Name];
      error?: { status?: string; message?: string; details?: unknown };
    }>(
      this.session.fetch,
      `https://${functionsRegion}-${projectId}.cloudfunctions.net/${name}`,
      {
        method: "POST",
        headers: jsonHeaders({ authorization: `Bearer ${await this.session.getIdToken()}` }),
        body: JSON.stringify({ data }),
      },
    );
    if (response.error) {
      throw new BabyDaybookApiError(response.error.message ?? `Cloud function ${name} failed`, {
        code: response.error.status,
        details: response.error.details,
      });
    }
    return (response.result ?? response.data) as BabyDaybookCloudFunctionResults[Name];
  }
}

export class FamilyClient {
  readonly functions: CallableFunctionsClient;

  constructor(functions: CallableFunctionsClient) {
    this.functions = functions;
  }

  async sendInvite(babyUid: string, caregiverEmail: string): Promise<void> {
    await this.functions.call("sendPendingInvite", { babyUid, caregiverEmail });
  }

  async cancelInvite(babyUid: string, caregiverEmail: string): Promise<void> {
    await this.functions.call("cancelPendingInvite", { babyUid, caregiverEmail });
  }

  async acceptInvite(babyUid: string): Promise<void> {
    await this.functions.call("acceptPendingInvite", { babyUid });
  }

  async declineInvite(babyUid: string): Promise<void> {
    await this.functions.call("declinePendingInvite", { babyUid });
  }

  async leaveBaby(babyUid: string): Promise<void> {
    await this.functions.call("removeSelfFromCaregivers", { babyUid });
  }

  async removeCaregiver(babyUid: string, caregiverUid: string): Promise<void> {
    await this.functions.call("removeAcceptedInvite", { babyUid, caregiverUid });
  }

  async changePrimaryCaregiver(babyUid: string, newUserUid: string): Promise<void> {
    await this.functions.call("changePrimaryCaregiver", { babyUid, newUserUid });
  }

  async getUserWithPremiumStatus(email: string): Promise<CaregiverInfo | undefined> {
    const result = await this.functions.call("getUserWithPremiumStatusByEmail", { email });
    if (!result || typeof result !== "object" || typeof result.success !== "boolean") {
      throw new BabyDaybookApiError("Malformed caregiver lookup response", { details: result });
    }
    if (!result.success) return undefined;
    if (!isUser(result.user) || typeof result.isPremium !== "boolean") {
      throw new BabyDaybookApiError("Malformed caregiver lookup response", { details: result });
    }
    return { user: result.user, isPremium: result.isPremium };
  }
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const user = value as Partial<User>;
  return typeof user.uid === "string"
    && (user.provider === undefined || typeof user.provider === "string")
    && (user.providerUid === undefined || typeof user.providerUid === "string")
    && (user.email === undefined || typeof user.email === "string")
    && (user.emailMD5 === undefined || typeof user.emailMD5 === "string")
    && (user.displayName === undefined || typeof user.displayName === "string")
    && (user.profilePhotoUrl === undefined || typeof user.profilePhotoUrl === "string")
    && (user.referringUserUid === undefined || typeof user.referringUserUid === "string")
    && (user.svt === undefined || typeof user.svt === "number")
    && (user.deleted === undefined || typeof user.deleted === "boolean");
}
