import { describe, expect, it } from "vitest";

import { createInitialTabMemory } from "./tabNavigation";
import {
  createWebNavigationSnapshot,
  isCurrentWebNavigationSession,
  restoreWebNavigationSnapshot,
} from "./webNavigationHistory";

describe("web navigation history snapshots", () => {
  it("round-trips tab state, reference navigation and scroll position through browser-safe JSON", () => {
    const memory = createInitialTabMemory();
    memory.journal.month = new Date("2026-07-01T00:00:00.000Z");
    memory.journal.selectedDate = "2026-07-22";
    memory.journal.selectedSubject = "数学";
    memory.journal.searchOpen = true;
    memory.journal.searchQuery = "二重积分";
    memory.journal.recordId = "record-b";
    memory.journal.referenceStack = [{ kind: "record", recordId: "record-a", recordEditing: true, scrollY: 248 }];
    memory.more.subRoute = "recordings";
    memory.more.recordingsState = {
      selectedSubject: "英语",
      playerAssetId: "audio-1",
      query: "听力",
      searchOpen: true,
    };

    const snapshot = createWebNavigationSnapshot("session-1", "journal", memory, "ai-session-1", 384);
    const restored = restoreWebNavigationSnapshot(JSON.parse(JSON.stringify(snapshot)));

    expect(restored).toEqual({
      ...snapshot,
      tabMemory: {
        ...memory,
        journal: {
          ...memory.journal,
          month: new Date("2026-07-01T00:00:00.000Z"),
        },
      },
    });
    expect(restored?.tabMemory.journal.month).toBeInstanceOf(Date);
    expect(restored?.tabMemory.journal.referenceStack?.[0]).toMatchObject({ recordId: "record-a", scrollY: 248 });
  });

  it("rejects foreign, stale or malformed history state", () => {
    const snapshot = createWebNavigationSnapshot("session-1", "today", createInitialTabMemory(), null, 0);

    expect(restoreWebNavigationSnapshot({ ...snapshot, kind: "other-app" })).toBeNull();
    expect(restoreWebNavigationSnapshot({ ...snapshot, version: 999 })).toBeNull();
    expect(restoreWebNavigationSnapshot({ ...snapshot, tabMemory: { ...snapshot.tabMemory, journal: { ...snapshot.tabMemory.journal, month: "not-a-date" } } })).toBeNull();
    expect(restoreWebNavigationSnapshot({ ...snapshot, scrollY: -1 })).toBeNull();
  });

  it("recognises only the current application navigation session", () => {
    const snapshot = createWebNavigationSnapshot("current-session", "more", createInitialTabMemory(), null, 24);

    expect(isCurrentWebNavigationSession(snapshot, "current-session")).toBe(true);
    expect(isCurrentWebNavigationSession(snapshot, "other-session")).toBe(false);
    expect(isCurrentWebNavigationSession({}, "current-session")).toBe(false);
  });
});
