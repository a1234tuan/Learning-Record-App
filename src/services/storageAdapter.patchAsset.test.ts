import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset, Block, ContentTemplate, RecordDraft } from "../types";

const stamp = "2026-06-21T00:00:00.000Z";

class AssetTable {
  private rows = new Map<string, Asset>();

  async get(id: string): Promise<Asset | undefined> {
    return this.rows.get(id);
  }

  async put(asset: Asset): Promise<string> {
    this.rows.set(asset.id, asset);
    return asset.id;
  }
}

class BlockTable {
  async toArray(): Promise<Block[]> {
    return [];
  }

  async bulkPut(_blocks: Block[]): Promise<void> {}
}

class RecordDraftTable {
  async toArray(): Promise<RecordDraft[]> {
    return [];
  }

  async bulkPut(_drafts: RecordDraft[]): Promise<void> {}
}

class TemplateTable {
  async toArray(): Promise<ContentTemplate[]> {
    return [];
  }

  async bulkPut(_templates: ContentTemplate[]): Promise<void> {}
}

const blob = () => new Blob(["asset-bytes"], { type: "image/png" });

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: "asset-1",
  createdAt: stamp,
  updatedAt: stamp,
  fileName: "photo.png",
  title: "原标题",
  mimeType: "image/png",
  size: 11,
  kind: "image",
  data: blob(),
  ...overrides,
});

const setup = async () => {
  vi.resetModules();
  const assets = new AssetTable();
  const blocks = new BlockTable();
  const recordDrafts = new RecordDraftTable();
  const templates = new TemplateTable();
  vi.doMock("../db/database", () => ({
    db: {
      assets,
      blocks,
      recordDrafts,
      templates,
      transaction: async (_mode: string, ...args: unknown[]) => (args.at(-1) as () => Promise<unknown>)(),
    },
  }));
  const { DexieStorageAdapter } = await import("./storageAdapter");
  return { adapter: new DexieStorageAdapter(), assets };
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

describe("DexieStorageAdapter patchAsset", () => {
  it("does not bump updatedAt when the patch carries no real change", async () => {
    const { adapter, assets } = await setup();
    await assets.put(asset());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    // Re-submitting the same title (as a UI form re-save might) should be a no-op — including not
    // being fooled by the two Blob object references (existing vs. any freshly-read one) that
    // deepEqualIgnoring must exclude from comparison via the "data" ignore key.
    const resaved = await adapter.patchAsset("asset-1", { title: "原标题" });

    expect(resaved?.updatedAt).toBe(stamp);
  });

  it("bumps updatedAt when the title genuinely changes", async () => {
    const { adapter, assets } = await setup();
    await assets.put(asset());

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.patchAsset("asset-1", { title: "新标题" });

    expect(resaved?.updatedAt).toBe("2026-06-22T00:00:00.000Z");
    expect(resaved?.title).toBe("新标题");
  });

  it("bumps updatedAt when ocrStatus genuinely changes", async () => {
    const { adapter, assets } = await setup();
    await assets.put(asset({ ocrStatus: "idle" }));

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const resaved = await adapter.patchAsset("asset-1", { ocrStatus: "done" });

    expect(resaved?.updatedAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("preserves the original Blob reference when the patch is a no-op", async () => {
    const { adapter, assets } = await setup();
    const original = asset();
    await assets.put(original);

    const resaved = await adapter.patchAsset("asset-1", { title: "原标题" });

    expect(resaved?.data).toBe(original.data);
  });
});

describe("DexieStorageAdapter renameAssetTitle", () => {
  it("does not bump updatedAt when renaming to the asset's current title", async () => {
    const { adapter, assets } = await setup();
    await assets.put(asset({ title: "图片标题" }));

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    await adapter.renameAssetTitle("asset-1", "图片标题");

    const stored = await assets.get("asset-1");
    expect(stored?.updatedAt).toBe(stamp);
  });

  it("bumps updatedAt when renaming to a genuinely different title", async () => {
    const { adapter, assets } = await setup();
    await assets.put(asset({ title: "图片标题" }));

    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    await adapter.renameAssetTitle("asset-1", "新的图片标题");

    const stored = await assets.get("asset-1");
    expect(stored?.updatedAt).toBe("2026-06-22T00:00:00.000Z");
    expect(stored?.title).toBe("新的图片标题");
  });
});
