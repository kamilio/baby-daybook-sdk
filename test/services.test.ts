import { describe, expect, it } from "vitest";
import {
  AuthSession,
  CallableFunctionsClient,
  CollectionRepository,
  FamilyClient,
  FirebaseStorageClient,
  activitiesToCsv,
  summarizeActivities,
} from "../src/index.js";
import type { DailyAction, FirestoreClient } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

describe("service clients", () => {
  it("calls Firebase callable functions with app-compatible payloads", async () => {
    const fetch = mockFetch((url, init) => {
      expect(url).toContain("us-central1-baby-daybook-app.cloudfunctions.net/sendPendingInvite");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer id");
      expect(JSON.parse(String(init?.body))).toEqual({ data: { babyUid: "baby", caregiverEmail: "care@example.com" } });
      return jsonResponse({ result: { success: true } });
    });
    const functions = new CallableFunctionsClient(session(fetch));
    await expect(new FamilyClient(functions).sendInvite("baby", "care@example.com")).resolves.toBeUndefined();
  });

  it("surfaces callable and storage protocol failures", async () => {
    const functionClient = new CallableFunctionsClient(session(mockFetch(jsonResponse({ error: { status: "FAILED_PRECONDITION", message: "No access", details: { reason: "premium" } } }))));
    await expect(functionClient.call("deleteUserAccount")).rejects.toMatchObject({ code: "FAILED_PRECONDITION", message: "No access" });

    const storage = new FirebaseStorageClient(session(mockFetch(new Response("denied", { status: 403 }))));
    await expect(storage.download("missing")).rejects.toMatchObject({ status: 403 });
  });

  it("exposes every family cloud action", async () => {
    const fetch = mockFetch(
      ...Array.from({ length: 6 }, () => jsonResponse({ result: true })),
      jsonResponse({ result: { success: true, user: { uid: "care", email: "care@example.com" }, isPremium: true } }),
    );
    const family = new FamilyClient(new CallableFunctionsClient(session(fetch)));
    await family.cancelInvite("baby", "care@example.com");
    await family.acceptInvite("baby");
    await family.declineInvite("baby");
    await family.leaveBaby("baby");
    await family.removeCaregiver("baby", "care");
    await family.changePrimaryCaregiver("baby", "next");
    await expect(family.getUserWithPremiumStatus("care@example.com")).resolves.toEqual({
      user: { uid: "care", email: "care@example.com" },
      isPremium: true,
    });
    const bodies = fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).data);
    expect(bodies).toEqual([
      { babyUid: "baby", caregiverEmail: "care@example.com" },
      { babyUid: "baby" },
      { babyUid: "baby" },
      { babyUid: "baby" },
      { babyUid: "baby", caregiverUid: "care" },
      { babyUid: "baby", newUserUid: "next" },
      { email: "care@example.com" },
    ]);
  });

  it("matches native caregiver lookup absence and response validation", async () => {
    const family = new FamilyClient(new CallableFunctionsClient(session(mockFetch(
      jsonResponse({ result: { success: false } }),
      jsonResponse({ result: { success: true, user: { email: "missing-uid@example.com" }, isPremium: false } }),
      jsonResponse({}),
    ))));
    await expect(family.getUserWithPremiumStatus("missing@example.com")).resolves.toBeUndefined();
    await expect(family.getUserWithPremiumStatus("broken@example.com")).rejects.toThrow("Malformed caregiver lookup response");
    await expect(family.getUserWithPremiumStatus("empty@example.com")).rejects.toThrow("Malformed caregiver lookup response");
  });

  it("uploads, downloads, and deletes attachment files", async () => {
    const fetch = mockFetch(
      (url, init) => {
        expect(url).toContain("uploadType=media");
        expect(url).toContain("name=files%2Fmoments%2FbabyUid_b%2Fm%2Fphoto.jpg");
        expect(init?.body).toBe("image");
        return jsonResponse({ name: "file" });
      },
      new Response(new Uint8Array([1, 2, 3])),
      jsonResponse(undefined),
    );
    const storage = new FirebaseStorageClient(session(fetch));
    const path = storage.attachmentPath("moments", "b", "m", "photo.jpg");
    await expect(storage.upload(path, "image", "image/jpeg")).resolves.toEqual({ name: "file" });
    await expect(storage.download(path)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await storage.delete(path);
  });

  it("uses native thumbnail names, falls back to originals, and removes both files", async () => {
    const fetch = mockFetch(
      (url) => {
        expect(url).toContain(encodeURIComponent("files/moments/babyUid_b/m/thumb_photo.jpg"));
        return new Response("missing", { status: 404 });
      },
      (url) => {
        expect(url).toContain(encodeURIComponent("files/moments/babyUid_b/m/photo.jpg"));
        return new Response(new Uint8Array([4, 5]));
      },
      (url, init) => {
        expect(url).toContain(encodeURIComponent("files/moments/babyUid_b/m/photo.jpg"));
        expect(init?.method).toBe("DELETE");
        return jsonResponse(undefined);
      },
      (url, init) => {
        expect(url).toContain(encodeURIComponent("files/moments/babyUid_b/m/thumb_photo.jpg"));
        expect(init?.method).toBe("DELETE");
        return new Response("missing", { status: 404 });
      },
    );
    const storage = new FirebaseStorageClient(session(fetch));
    expect(storage.attachmentThumbnailPath("moments", "b", "m", "photo.jpg")).toBe("files/moments/babyUid_b/m/thumb_photo.jpg");
    await expect(storage.downloadAttachment("moments", "b", "m", "photo.jpg", true)).resolves.toEqual(new Uint8Array([4, 5]));
    await expect(storage.deleteAttachment("moments", "b", "m", "thumb_photo.jpg")).resolves.toBeUndefined();
  });

  it("implements repository CRUD with document IDs", async () => {
    const firestore = {
      list: async () => [{ id: "a", path: "x/a", data: { value: 1 } }],
      get: async () => ({ id: "a", path: "x/a", data: { uid: "a", value: 1 } }),
      set: async (_path: string, data: Record<string, unknown>) => ({ id: "a", path: "x/a", data }),
      delete: async () => undefined,
    } as unknown as FirestoreClient;
    const repository = new CollectionRepository<{ uid: string; value: number; deleted?: boolean }>(firestore, "x");
    await expect(repository.list()).resolves.toEqual([{ uid: "a", value: 1 }]);
    await expect(repository.get("a")).resolves.toMatchObject({ uid: "a" });
    await expect(repository.save({ uid: "a", value: 2 })).resolves.toMatchObject({ value: 2 });
    await expect(repository.softDelete("a")).resolves.toMatchObject({ deleted: true });
    await repository.hardDelete("a");
    await expect(repository.save({ uid: "", value: 1 })).rejects.toThrow("Missing uid");
  });
});

describe("activity analytics", () => {
  const activities: DailyAction[] = [
    action({ uid: "a", type: "sleeping", startMillis: 0, endMillis: 1000 }),
    action({ uid: "b", type: "bottle", startMillis: 0, duration: 500, volume: 120, notes: "quoted, note" }),
    action({ uid: "c", type: "bottle", startMillis: 0, amount: 2, deleted: true }),
  ];

  it("summarizes active records by activity type", () => {
    expect(summarizeActivities(activities)).toEqual({
      count: 2,
      totalDurationMillis: 1500,
      totalVolume: 120,
      totalAmount: 0,
      byType: {
        sleeping: { count: 1, durationMillis: 1000, volume: 0, amount: 0 },
        bottle: { count: 1, durationMillis: 500, volume: 120, amount: 0 },
      },
    });
  });

  it("exports RFC-compatible CSV cells", () => {
    const csv = activitiesToCsv(activities);
    expect(csv).toContain('"quoted, note"');
    expect(csv.split("\n")).toHaveLength(4);
  });
});

function session(fetch: ReturnType<typeof mockFetch>): AuthSession {
  return new AuthSession({ idToken: "id", userId: "user", expiresAt: Date.now() + 3600_000 }, { fetch });
}

function action(update: Partial<DailyAction>): DailyAction {
  return { uid: "id", userUid: "user", babyUid: "baby", type: "other", startMillis: 0, ...update };
}
