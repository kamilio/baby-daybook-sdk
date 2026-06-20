import { BabyDaybookApiError } from "./errors.js";
import { jsonHeaders, requestJson } from "./http.js";
import type { AuthSession } from "./auth.js";

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

export class CallableFunctionsClient {
  readonly session: AuthSession;

  constructor(session: AuthSession) {
    this.session = session;
  }

  async call<T>(name: BabyDaybookCloudFunction, data: Record<string, unknown> = {}): Promise<T> {
    const { projectId, functionsRegion } = this.session.config;
    const response = await requestJson<{ result?: T; data?: T; error?: { status?: string; message?: string; details?: unknown } }>(
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
    return (response.result ?? response.data) as T;
  }
}

export class FamilyClient {
  readonly functions: CallableFunctionsClient;

  constructor(functions: CallableFunctionsClient) {
    this.functions = functions;
  }

  sendInvite(babyUid: string, caregiverEmail: string): Promise<unknown> {
    return this.functions.call("sendPendingInvite", { babyUid, caregiverEmail });
  }

  cancelInvite(babyUid: string, caregiverEmail: string): Promise<unknown> {
    return this.functions.call("cancelPendingInvite", { babyUid, caregiverEmail });
  }

  acceptInvite(babyUid: string): Promise<unknown> {
    return this.functions.call("acceptPendingInvite", { babyUid });
  }

  declineInvite(babyUid: string): Promise<unknown> {
    return this.functions.call("declinePendingInvite", { babyUid });
  }

  leaveBaby(babyUid: string): Promise<unknown> {
    return this.functions.call("removeSelfFromCaregivers", { babyUid });
  }

  removeCaregiver(babyUid: string, caregiverUid: string): Promise<unknown> {
    return this.functions.call("removeAcceptedInvite", { babyUid, caregiverUid });
  }

  changePrimaryCaregiver(babyUid: string, newUserUid: string): Promise<unknown> {
    return this.functions.call("changePrimaryCaregiver", { babyUid, newUserUid });
  }

  getUserWithPremiumStatus(email: string): Promise<unknown> {
    return this.functions.call("getUserWithPremiumStatusByEmail", { email });
  }
}
