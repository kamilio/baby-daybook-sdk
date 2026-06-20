import { describe, expect, it } from "vitest";
import { activitiesToPdf } from "../src/index.js";
import type { DailyAction } from "../src/index.js";

describe("PDF exports", () => {
  it("creates a valid deterministic single-page PDF", () => {
    const bytes = activitiesToPdf([
      activity({ uid: "a", type: "bottle", startMillis: Date.UTC(2026, 6, 6, 8), amount: 4, amountUnit: "oz", notes: "Milk (warm) \\ ready" }),
      activity({ uid: "b", type: "sleeping", startMillis: Date.UTC(2026, 6, 6, 9), endMillis: Date.UTC(2026, 6, 6, 10, 30) }),
      activity({ uid: "c", type: "other", startMillis: Date.UTC(2026, 6, 6, 11), deleted: true }),
    ], {
      babyName: "Ada",
      generatedAt: Date.UTC(2026, 6, 6, 12),
    });
    const pdf = new TextDecoder().decode(bytes);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/Type /Pages");
    expect(pdf).toContain("/Count 1");
    expect(pdf).toContain("Baby: Ada");
    expect(pdf).toContain("Activities: 2");
    expect(pdf).toContain("Milk \\(warm\\) \\\\ ready");
    expect(pdf.endsWith("%%EOF\n")).toBe(true);
    expectValidXref(pdf);
  });

  it("paginates large reports and includes deleted rows on request", () => {
    const rows = Array.from({ length: 100 }, (_, index) => activity({
      uid: String(index),
      type: "bottle",
      startMillis: Date.UTC(2026, 6, 6, 8) + index * 60_000,
      deleted: index === 0,
    }));
    const pdf = new TextDecoder().decode(activitiesToPdf(rows, { includeDeleted: true, generatedAt: 0 }));
    expect(pdf).toContain("/Count 3");
    expect(pdf).toContain("Activities: 100");
    expect(pdf).toContain("Page 3 of 3");
    expectValidXref(pdf);
  });

  it("filters report rows by timestamp", () => {
    const pdf = new TextDecoder().decode(activitiesToPdf([
      activity({ uid: "a", type: "before", startMillis: 100 }),
      activity({ uid: "b", type: "inside", startMillis: 200 }),
      activity({ uid: "c", type: "after", startMillis: 300 }),
    ], { fromMillis: 150, toMillis: 250, generatedAt: 0 }));
    expect(pdf).toContain("inside");
    expect(pdf).not.toContain("before");
    expect(pdf).not.toContain("after");
  });
});

function expectValidXref(pdf: string): void {
  const startXref = Number(pdf.match(/startxref\n(\d+)\n/)?.[1]);
  expect(pdf.slice(startXref, startXref + 4)).toBe("xref");
  const entries = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)];
  entries.forEach((entry, index) => {
    const offset = Number(entry[1]);
    expect(pdf.slice(offset, offset + String(index + 1).length + 6)).toBe(`${index + 1} 0 obj`);
  });
}

function activity(update: Partial<DailyAction>): DailyAction {
  return { uid: "id", userUid: "u", babyUid: "b", type: "other", startMillis: 0, ...update };
}
