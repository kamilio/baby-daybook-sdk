import { expect } from "vitest";
import { decodeFields, encodeFields } from "../src/firestore.js";
import type { FetchLike } from "../src/types.js";

export const diaperCollection = "babyData/babyUid_baby/dailyActions";

export function diaperStore() {
  const records = new Map<string, Record<string, unknown>>();
  const state = {
    records,
    commits: 0,
    pageSize: 1000,
    failure: undefined as "before" | "after" | "readback" | undefined,
    fetch: undefined as unknown as FetchLike,
  };
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
      const writes = JSON.parse(String(init.body)).writes;
      expect(writes).toHaveLength(1);
      const write = writes[0];
      const recordPath = write.update.name.split("/documents/")[1];
      const fields = decodeFields(write.update.fields);
      records.set(recordPath, write.updateMask ? { ...records.get(recordPath), ...fields } : fields);
      state.commits += 1;
      if (state.failure === "after") {
        state.failure = undefined;
        throw new Error("Commit response lost");
      }
      return Response.json({ writeResults: [{ updateTime: "2026-08-31T00:00:00.000Z" }] });
    }
    expect(init.method ?? "GET").toBe("GET");
    const recordPath = documentPath.slice(1);
    if (recordPath === diaperCollection) {
      const offset = Number(url.searchParams.get("pageToken") ?? 0);
      const matches = [...records].filter(([storedPath]) => storedPath.startsWith(`${diaperCollection}/`));
      const page = matches.slice(offset, offset + state.pageSize);
      return Response.json({
        documents: page.map(([storedPath, data]) => wire(storedPath, data)),
        ...(offset + page.length < matches.length ? { nextPageToken: String(offset + page.length) } : {}),
      });
    }
    if (records.has(recordPath)) {
      if (state.failure === "readback") {
        state.failure = undefined;
        throw new Error("Readback response lost");
      }
      return Response.json(wire(recordPath, records.get(recordPath)!));
    }
    throw new Error(`Unexpected fixture path: ${recordPath}`);
  };
  return state;
}
