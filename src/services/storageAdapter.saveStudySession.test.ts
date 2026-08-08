import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudySession } from "../types";

const stamp = "2026-06-21T00:00:00.000Z";

class StudySessionTable {
  private rows = new Map<string, StudySession>();

  async get(id: string): Promise<StudySession | undefined> {
    return this.rows.get(id);
  }

  async put(session: StudySession): Promise<string> {
    this.rows.set(session.id, session);
    return session.id;
  }

  where(_index: string) {
    return {
      equals: (_value: string) => ({
        toArray: async () => [],
      }),
    };
  }
}

const session = (overrides: Partial<StudySession> = {}): StudySession => ({
  id: "session-1",
  createdAt: stamp,
  updatedAt: stamp,
  date: "2026-06-21",
  subject: "数学",
  minutes: 45,
  note: "复习真题",
  ...overrides,
});

const setup = async () => {
  vi.resetModules();
  const studySessions = new StudySessionTable();
  vi.doMock("../db/database", () => ({ db: { studySessions } }));
  const { DexieStorageAdapter } = await import("./storageAdapter");
  return new DexieStorageAdapter();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(stamp));
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("../db/database");
  vi.resetModules();
});

describe("DexieStorageAdapter saveStudySession", () => {
  it("does not bump updatedAt when re-saving an unchanged session", async () => {
    const adapter = await setup();
    const first = await adapter.saveStudySession(session());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveStudySession({ ...first, updatedAt: "2026-06-22T00:00:00.000Z" });

    expect(resaved.updatedAt).toBe(first.updatedAt);
    expect(resaved).toBe(first);
  });

  it("bumps updatedAt when minutes genuinely change", async () => {
    const adapter = await setup();
    const first = await adapter.saveStudySession(session());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveStudySession({ ...first, minutes: 60 });

    expect(resaved.updatedAt).not.toBe(first.updatedAt);
    expect(resaved.updatedAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("bumps updatedAt when note genuinely changes", async () => {
    const adapter = await setup();
    const first = await adapter.saveStudySession(session());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveStudySession({ ...first, note: "换了一份笔记" });

    expect(resaved.updatedAt).not.toBe(first.updatedAt);
  });
});
