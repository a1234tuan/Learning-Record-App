import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DayEntry } from "../types";

const stamp = "2026-06-21T00:00:00.000Z";

class EntryTable {
  private rows = new Map<string, DayEntry>();

  async get(id: string): Promise<DayEntry | undefined> {
    return this.rows.get(id);
  }

  async put(entry: DayEntry): Promise<string> {
    this.rows.set(entry.id, entry);
    return entry.id;
  }

  orderBy(_index: string) {
    return {
      reverse: () => ({
        filter: (predicate: (entry: DayEntry) => boolean) => ({
          toArray: async () => Array.from(this.rows.values()).filter(predicate),
        }),
      }),
    };
  }
}

const entry = (overrides: Partial<DayEntry> = {}): DayEntry => ({
  id: "entry-1",
  createdAt: stamp,
  updatedAt: stamp,
  date: "2026-06-21",
  title: "周记",
  tags: ["重点"],
  pinned: false,
  favorite: false,
  summary: "今天复习了导数",
  ...overrides,
});

const setup = async () => {
  vi.resetModules();
  const entries = new EntryTable();
  vi.doMock("../db/database", () => ({ db: { entries } }));
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

describe("DexieStorageAdapter saveEntry", () => {
  it("does not bump updatedAt when re-saving with unchanged content", async () => {
    const adapter = await setup();
    const first = await adapter.saveEntry(entry());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveEntry({ ...first, updatedAt: "2026-06-22T00:00:00.000Z" });

    expect(resaved.updatedAt).toBe(first.updatedAt);
    expect(resaved).toBe(first);
  });

  it("bumps updatedAt when the title genuinely changes", async () => {
    const adapter = await setup();
    const first = await adapter.saveEntry(entry());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveEntry({ ...first, title: "新标题" });

    expect(resaved.updatedAt).not.toBe(first.updatedAt);
    expect(resaved.updatedAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("bumps updatedAt when pinned/favorite flags genuinely change", async () => {
    const adapter = await setup();
    const first = await adapter.saveEntry(entry());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveEntry({ ...first, pinned: true });

    expect(resaved.updatedAt).not.toBe(first.updatedAt);
  });

  it("bumps updatedAt when tags genuinely change", async () => {
    const adapter = await setup();
    const first = await adapter.saveEntry(entry());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveEntry({ ...first, tags: ["重点", "新增标签"] });

    expect(resaved.updatedAt).not.toBe(first.updatedAt);
  });
});
