import { expect } from "vitest";
import { decodeFields, encodeFields } from "../src/firestore.js";
import type { FetchLike } from "../src/types.js";

export const timerCollection = "babyData/babyUid_baby/dailyActions";

export function sideTimerStore(type: string) {
  const records = new Map<string, Record<string, unknown>>();
  const writes: Array<Record<string, unknown>> = [];
  const state = {
    records,
    writes,
    failure: undefined as "before" | "after" | "readback" | undefined,
    fetch: undefined as unknown as FetchLike,
  };
  let failReadback = false;
  const wire = (recordPath: string, data: Record<string, unknown>) => ({
    name: `projects/fixture/databases/(default)/documents/${recordPath}`,
    fields: encodeFields(data),
  });
  state.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe("firestore.googleapis.com");
    const documentPath = decodeURIComponent(url.pathname.split("/documents")[1] ?? "");
    if (documentPath === ":commit") {
      expect(init.method).toBe("POST");
      if (state.failure === "before") {
        state.failure = undefined;
        throw new Error("Commit not sent");
      }
      const submitted = JSON.parse(String(init.body)).writes;
      expect(submitted).toHaveLength(1);
      const write = submitted[0];
      const recordPath = write.update.name.split("/documents/")[1];
      expect(recordPath.startsWith(`${timerCollection}/`)).toBe(true);
      const fields = decodeFields(write.update.fields);
      const saved = write.updateMask ? { ...records.get(recordPath) } : {};
      for (const field of write.updateMask?.fieldPaths ?? Object.keys(fields)) {
        if (Object.hasOwn(fields, field)) saved[field] = fields[field];
        else delete saved[field];
      }
      records.set(recordPath, saved);
      writes.push(structuredClone(saved));
      if (state.failure === "after") {
        state.failure = undefined;
        throw new Error("Commit response lost");
      }
      if (state.failure === "readback") {
        state.failure = undefined;
        failReadback = true;
      }
      return Response.json({ writeResults: [{ updateTime: "2026-08-31T00:00:00.000Z" }] });
    }
    expect(init.method ?? "GET").toBe("GET");
    const recordPath = documentPath.slice(1);
    if (recordPath === timerCollection) {
      return Response.json({ documents: [...records].map(([storedPath, data]) => wire(storedPath, data)) });
    }
    if (recordPath === "babyData/babyUid_baby/daTypes") {
      return Response.json({ documents: [wire(`${recordPath}/${type}`, { uid: type, userUid: "user", babyUid: "baby", title: type, hasDuration: 1 })] });
    }
    if (["babyData/babyUid_baby/groups", "userData/user/babiesSettings/babyUid_baby/settings"].includes(recordPath)) {
      return Response.json({ documents: [] });
    }
    if (recordPath.startsWith(`${timerCollection}/`)) {
      if (failReadback) {
        failReadback = false;
        throw new Error("Readback response lost");
      }
      const record = records.get(recordPath);
      return record ? Response.json(wire(recordPath, record)) : Response.json({ error: { message: "Not found" } }, { status: 404 });
    }
    throw new Error(`Unexpected fixture path: ${recordPath}`);
  };
  return state;
}
