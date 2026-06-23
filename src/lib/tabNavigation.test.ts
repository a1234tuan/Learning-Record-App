import { describe, expect, it } from "vitest";

import { createInitialTabMemory, getTabDepth, popTabDepth } from "./tabNavigation";

describe("tabNavigation", () => {
  it("keeps each tab state independent", () => {
    const memory = createInitialTabMemory();
    const next = {
      ...memory,
      today: { recordId: "today-record", recordEditing: true },
      categories: { ...memory.categories, activeSubject: "数学" },
      search: { ...memory.search, query: "极限" },
    };

    expect(getTabDepth("today", next)).toBe(1);
    expect(getTabDepth("categories", next)).toBe(1);
    expect(getTabDepth("search", next)).toBe(0);
    expect(next.search.query).toBe("极限");
  });

  it("pops only the current tab record depth", () => {
    const memory = {
      ...createInitialTabMemory(),
      today: { recordId: "today-record", recordEditing: true },
      categories: { ...createInitialTabMemory().categories, recordId: "category-record", activeSubject: "英语" },
    };

    const next = popTabDepth(memory, "today");

    expect(next.today.recordId).toBeUndefined();
    expect(next.today.recordEditing).toBeUndefined();
    expect(next.categories.recordId).toBe("category-record");
    expect(next.categories.activeSubject).toBe("英语");
  });

  it("returns journal subject records to the selected day first", () => {
    const memory = {
      ...createInitialTabMemory(),
      journal: {
        ...createInitialTabMemory().journal,
        selectedDate: "2026-06-23",
        selectedSubject: "政治",
      },
    };

    const next = popTabDepth(memory, "journal");

    expect(getTabDepth("journal", next)).toBe(1);
    expect(next.journal.selectedDate).toBe("2026-06-23");
    expect(next.journal.selectedSubject).toBeUndefined();
  });

  it("returns journal selected day to the root layer", () => {
    const memory = {
      ...createInitialTabMemory(),
      journal: {
        ...createInitialTabMemory().journal,
        selectedDate: "2026-06-23",
      },
    };

    const next = popTabDepth(memory, "journal");

    expect(getTabDepth("journal", next)).toBe(0);
    expect(next.journal.selectedDate).toBeUndefined();
  });

  it("keeps search query when returning from a search result record", () => {
    const memory = {
      ...createInitialTabMemory(),
      search: {
        query: "B树",
        recordId: "record-1",
        highlightAssetId: "asset-1",
      },
    };

    const next = popTabDepth(memory, "search");

    expect(next.search.recordId).toBeUndefined();
    expect(next.search.highlightAssetId).toBeUndefined();
    expect(next.search.query).toBe("B树");
  });

  it("pops more subpages back to the More root", () => {
    const memory = {
      ...createInitialTabMemory(),
      more: {
        subRoute: "settings" as const,
      },
    };

    const next = popTabDepth(memory, "more");

    expect(getTabDepth("more", next)).toBe(0);
    expect(next.more.subRoute).toBeNull();
  });
});
