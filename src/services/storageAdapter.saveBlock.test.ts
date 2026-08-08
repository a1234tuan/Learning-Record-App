import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordBlock } from "../types";

const stamp = "2026-06-21T00:00:00.000Z";

class BlockTable {
  private rows = new Map<string, RecordBlock>();

  async get(id: string): Promise<RecordBlock | undefined> {
    return this.rows.get(id);
  }

  async put(block: RecordBlock): Promise<string> {
    this.rows.set(block.id, block);
    return block.id;
  }

  // listBlocks(date) calls db.blocks.where("date").equals(date).filter(predicate).toArray() —
  // mirror that chain against the in-memory rows instead of returning an empty stub, so tests can
  // assert on the persisted order via the adapter's own read path.
  where(index: string) {
    return {
      equals: (value: string) => {
        const matching = () => Array.from(this.rows.values()).filter((row) => (row as unknown as Record<string, unknown>)[index] === value);
        return {
          toArray: async () => matching(),
          filter: (predicate: (row: RecordBlock) => boolean) => ({
            toArray: async () => matching().filter(predicate),
          }),
        };
      },
    };
  }
}

class RecordDraftTable {
  async delete(_id: string): Promise<void> {}
}

class StudySessionTable {
  where(_index: string) {
    return {
      equals: (_value: string) => ({
        first: async () => undefined,
      }),
    };
  }

  async put(): Promise<void> {}
}

// Plain text with no embedded <record-asset>/<record-formula> nodes. hasLinearRecordNodes() is
// false for this, so normalizeRecordContent() re-appends record.assets/formulas as serialized
// nodes into contentHtml (a legacy-data-recovery path — it does NOT silently drop them). Tests
// that want a clean "nothing to normalize" round-trip use content that already carries the node
// instead, below.
const record = (overrides: Partial<RecordBlock> = {}): RecordBlock => ({
  id: "record-1",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject: "数学",
  title: "上下文切换",
  contentHtml: "<p>正文内容</p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
  tags: ["重点"],
  ...overrides,
});

const setup = async () => {
  vi.resetModules();
  const blocks = new BlockTable();
  const recordDrafts = new RecordDraftTable();
  const studySessions = new StudySessionTable();
  vi.doMock("../db/database", () => ({
    db: {
      blocks,
      recordDrafts,
      studySessions,
      transaction: async (_mode: string, ...args: unknown[]) => (args.at(-1) as () => Promise<unknown>)(),
    },
  }));
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

describe("DexieStorageAdapter saveBlock", () => {
  it("does not bump updatedAt when re-saving a record with unchanged content", async () => {
    const adapter = await setup();
    const first = await adapter.saveBlock(record());

    // Re-save the exact same visible content a tick later — simulates opening the editor and
    // saving without making any real edit (e.g. undo back to the original text).
    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveBlock({ ...first, updatedAt: "2026-06-22T00:00:00.000Z" } as RecordBlock);

    expect(resaved.updatedAt).toBe(first.updatedAt);
  });

  it("bumps updatedAt when the title genuinely changes", async () => {
    const adapter = await setup();
    const first = await adapter.saveBlock(record());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveBlock({ ...first, title: "新的标题" } as RecordBlock);

    expect(resaved.updatedAt).not.toBe(first.updatedAt);
    expect(resaved.updatedAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("bumps updatedAt when tags genuinely change", async () => {
    const adapter = await setup();
    const first = await adapter.saveBlock(record());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveBlock({ ...first, tags: ["重点", "新增标签"] } as RecordBlock);

    expect(resaved.updatedAt).not.toBe(first.updatedAt);
    expect(resaved.updatedAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("still detects no change when re-saving content that already carries its record-asset node", async () => {
    const adapter = await setup();
    // Content already contains the <record-asset> node, so hasLinearRecordNodes() is true and
    // normalizeRecordContent() returns contentHtml as-is — no re-append side effect. This is the
    // clean "nothing changed" round-trip: assets/formulas are re-extracted from the same markup.
    const withAsset = record({
      contentHtml: '<p>正文内容</p><record-asset data-asset-id="asset-1" data-kind="image" data-title="图1"></record-asset><p></p>',
      assets: [{ id: "asset-1", kind: "image", title: "图1" }],
    });
    const first = await adapter.saveBlock(withAsset) as RecordBlock;
    expect(first.assets).toEqual([{ id: "asset-1", kind: "image", title: "图1" }]);

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    // Caller re-submits the exact same record (as the editor would on an unmodified save).
    const resaved = await adapter.saveBlock({ ...first, updatedAt: "2026-06-22T00:00:00.000Z" } as RecordBlock) as RecordBlock;

    expect(resaved.updatedAt).toBe(first.updatedAt);
    expect(resaved.assets).toEqual([{ id: "asset-1", kind: "image", title: "图1" }]);
  });

  it("bumps updatedAt when a genuinely new asset node is added to the content", async () => {
    const adapter = await setup();
    const withAsset = record({
      contentHtml: '<p>正文内容</p><record-asset data-asset-id="asset-1" data-kind="image" data-title="图1"></record-asset><p></p>',
      assets: [{ id: "asset-1", kind: "image", title: "图1" }],
    });
    const first = await adapter.saveBlock(withAsset) as RecordBlock;

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.saveBlock({
      ...first,
      contentHtml: `${first.contentHtml}<record-asset data-asset-id="asset-2" data-kind="image" data-title="图2"></record-asset><p></p>`,
    } as RecordBlock) as RecordBlock;

    expect(resaved.updatedAt).not.toBe(first.updatedAt);
    expect(resaved.assets).toEqual([
      { id: "asset-1", kind: "image", title: "图1" },
      { id: "asset-2", kind: "image", title: "图2" },
    ]);
  });
});

describe("DexieStorageAdapter toggleRecordFavorite", () => {
  it("does not bump updatedAt when toggling to the same favorite value it already has", async () => {
    const adapter = await setup();
    const first = await adapter.saveBlock(record({ favorite: true }));

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.toggleRecordFavorite(first.id, true);

    expect(resaved?.updatedAt).toBe(first.updatedAt);
  });

  it("bumps updatedAt when the favorite value genuinely flips", async () => {
    const adapter = await setup();
    const first = await adapter.saveBlock(record({ favorite: false }));

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.toggleRecordFavorite(first.id, true);

    expect(resaved?.favorite).toBe(true);
    expect(resaved?.updatedAt).not.toBe(first.updatedAt);
    expect(resaved?.updatedAt).toBe("2026-06-22T00:00:00.000Z");
  });
});

describe("DexieStorageAdapter reorderBlocks", () => {
  it("does not bump updatedAt for a block whose order does not actually change", async () => {
    const adapter = await setup();
    const first = await adapter.saveBlock(record({ id: "record-1", order: 0 }));

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    // Reordering the list back to the same order it already had (e.g. a drag that snaps back).
    await adapter.reorderBlocks(first.date, [first.id]);

    const stored = await adapter.listBlocks(first.date);
    expect(stored[0].updatedAt).toBe(first.updatedAt);
  });

  it("bumps updatedAt for a block whose order genuinely changes", async () => {
    const adapter = await setup();
    const first = await adapter.saveBlock(record({ id: "record-1", order: 0 }));
    await adapter.saveBlock(record({ id: "record-2", order: 1 }));

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    await adapter.reorderBlocks(first.date, ["record-2", "record-1"]);

    const stored = await adapter.listBlocks(first.date);
    const reordered = stored.find((block) => block.id === "record-1");
    expect(reordered?.order).toBe(1);
    expect(reordered?.updatedAt).toBe("2026-06-22T00:00:00.000Z");
  });
});
