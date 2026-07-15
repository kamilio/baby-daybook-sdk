import { describe, expect, it } from "vitest";
import { AuthSession, BabyDaybookApiError, FirestoreClient, decodeFields, encodeFields } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

describe("FirestoreClient", () => {
  it("encodes and decodes Firestore values", () => {
    const encoded = encodeFields({
      string: "value",
      integer: 4,
      double: 1.5,
      boolean: true,
      nil: null,
      date: new Date("2026-01-01T00:00:00.000Z"),
      bytes: new Uint8Array([1, 2]),
      array: ["x", 2],
      map: { nested: "yes" },
      ignored: undefined,
    });
    const decoded = decodeFields(encoded);
    expect(decoded).toMatchObject({ string: "value", integer: 4, double: 1.5, boolean: true, nil: null, array: ["x", 2], map: { nested: "yes" } });
    expect(decoded.date).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(decoded.bytes).toEqual(new Uint8Array([1, 2]));
    expect(() => encodeFields({ invalid: Number.NaN })).toThrow(BabyDaybookApiError);
  });

  it("gets documents and treats missing documents as undefined", async () => {
    const fetch = mockFetch(
      jsonResponse({ name: "projects/p/databases/(default)/documents/userData/u", fields: { uid: { stringValue: "u" } } }),
      jsonResponse({ error: { message: "not found" } }, 404),
    );
    const firestore = client(fetch);
    await expect(firestore.get<{ uid: string }>("userData/u")).resolves.toMatchObject({ id: "u", data: { uid: "u" } });
    await expect(firestore.get("userData/missing")).resolves.toBeUndefined();
  });

  it("lists all pages and filters soft-deleted records", async () => {
    const fetch = mockFetch(
      (url) => {
        expect(url).not.toContain("babyData%2FbabyUid_b");
        expect(url).toContain("babyData/babyUid_b/dailyActions");
        return jsonResponse({ documents: [wire("a", { uid: "a" }), wire("b", { uid: "b", deleted: true })], nextPageToken: "next" });
      },
      (url) => {
        expect(url).toContain("pageToken=next");
        return jsonResponse({ documents: [wire("c", { uid: "c" })] });
      },
    );
    const records = await client(fetch).list<{ uid: string; deleted?: boolean }>("babyData/babyUid_b/dailyActions");
    expect(records.map((record) => record.id)).toEqual(["a", "c"]);
  });

  it("can include soft-deleted records", async () => {
    const fetch = mockFetch(jsonResponse({ documents: [wire("a", { uid: "a", deleted: true })] }));
    const records = await client(fetch).list<{ uid: string; deleted?: boolean }>("x", { includeDeleted: true, pageSize: 5 });
    expect(records).toHaveLength(1);
  });

  it("lists a single ordered page", async () => {
    const fetch = mockFetch((url) => {
      expect(url).toContain("pageSize=2");
      expect(url).toContain("pageToken=cursor");
      expect(url).toContain("orderBy=startMillis+desc");
      return jsonResponse({ documents: [wire("a", { uid: "a" })], nextPageToken: "next" });
    });
    await expect(client(fetch).listPage("x", { pageSize: 2, pageToken: "cursor", orderBy: "startMillis desc" }))
      .resolves.toMatchObject({ documents: [{ id: "a" }], nextPageToken: "next" });
  });

  it("writes with a server timestamp transform and can patch without one", async () => {
    const fetch = mockFetch(
      (url, init) => {
        expect(url.endsWith("documents:commit")).toBe(true);
        const write = JSON.parse(String(init?.body)).writes[0];
        expect(write.updateTransforms).toEqual([{ fieldPath: "svt", setToServerValue: "REQUEST_TIME" }]);
        return jsonResponse({ commitTime: "now" });
      },
      jsonResponse(wire("a", { uid: "a", svt: 123 })),
      (url, init) => {
        expect(url).toContain("updateMask.fieldPaths=uid");
        expect(init?.method).toBe("PATCH");
        return jsonResponse(wire("a", { uid: "a" }));
      },
      jsonResponse(undefined, 200),
    );
    const firestore = client(fetch);
    await expect(firestore.set("x/a", { uid: "a" }, { merge: true })).resolves.toMatchObject({ data: { uid: "a", svt: 123 } });
    await firestore.set("x/a", { uid: "a" }, { merge: true, serverTimestamp: false });
    await firestore.delete("x/a");
  });

  it("commits multiple server-timestamped writes atomically", async () => {
    const fetch = mockFetch((url, init) => {
      expect(url.endsWith("documents:commit")).toBe(true);
      const body = JSON.parse(String(init?.body));
      expect(body.writes).toHaveLength(2);
      expect(body.writes[0]).toMatchObject({
        update: {
          name: "projects/baby-daybook-app/databases/(default)/documents/x/a",
          fields: { uid: { stringValue: "a" } },
        },
        updateTransforms: [{ fieldPath: "svt", setToServerValue: "REQUEST_TIME" }],
      });
      expect(body.writes[1].updateMask).toEqual({ fieldPaths: ["uid"] });
      return jsonResponse({ commitTime: "now" });
    });
    const firestore = client(fetch);

    await expect(firestore.setMany([
      { path: "x/a", data: { uid: "a", svt: 0 } },
      { path: "x/b", data: { uid: "b" }, merge: true },
    ])).resolves.toBeUndefined();
    await expect(firestore.setMany([])).resolves.toBeUndefined();
    await expect(firestore.setMany(Array.from({ length: 501 }, (_, index) => ({ path: `x/${index}`, data: {} }))))
      .rejects.toThrow("at most 500 writes");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

function client(fetch: ReturnType<typeof mockFetch>): FirestoreClient {
  return new FirestoreClient(new AuthSession({ idToken: "id", userId: "user", expiresAt: Date.now() + 3600_000 }, { fetch }));
}

function wire(id: string, data: Record<string, unknown>) {
  return { name: `projects/p/databases/(default)/documents/x/${id}`, fields: encodeFields(data) };
}
