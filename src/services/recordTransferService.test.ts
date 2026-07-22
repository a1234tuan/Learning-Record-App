import { describe, expect, it, vi } from "vitest";

import type { Asset, RecordBlock, RecordTransferPackage, StorageAdapter } from "../types";
import {
  createRecordTransferPackage,
  importRecordTransferPackage,
  parseRecordTransferPackage,
} from "./recordTransferService";

const stamp = "2026-07-22T00:00:00.000Z";

const makeAsset = (id: string, data = "image-data"): Asset => ({
  id,
  createdAt: stamp,
  updatedAt: stamp,
  fileName: `${id}.png`,
  title: id,
  mimeType: "image/png",
  size: new Blob([data]).size,
  kind: "image",
  data: new Blob([data], { type: "image/png" }),
});

const makeRecord = (id: string, assetId: string): RecordBlock => ({
  id,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-07-22",
  order: 0,
  subject: "数学",
  title: "二重积分",
  contentHtml: `<p>公式 <record-asset data-asset-id="${assetId}" data-kind="image" data-title="图"></record-asset> <record-reference data-record-id="${id}" data-title="二重积分"></record-reference></p>`,
  assets: [{ id: assetId, kind: "image", title: "图" }],
  formulas: [],
  mistakeRefs: [],
});

const transfer = (record: RecordBlock, asset: Asset): RecordTransferPackage => ({
  payload: {
    manifest: {
      format: "study-journal-record-transfer",
      version: 1,
      exportedAt: stamp,
      appVersion: "0.1.0",
      counts: { records: 1, assets: 1 },
    },
    records: [record],
    subjects: [record.subject],
    assets: [(() => {
      const { data: _data, ...meta } = asset;
      return { ...meta, path: `assets/${asset.id}` };
    })()],
  },
  readAsset: async (_id, signal) => {
    if (signal?.aborted) {
      throw new Error("已取消日志互通操作，当前本地数据没有修改。");
    }
    return new File([asset.data], asset.fileName, { type: asset.mimeType });
  },
});

describe("recordTransferService", () => {
  it("round-trips original HTML and reads resources on demand", async () => {
    const record = makeRecord("record-source", "asset-source");
    const asset = makeAsset("asset-source");
    const store = {
      listBlocks: vi.fn(async () => [record]),
      getSettings: vi.fn(async () => ({ id: "settings" })),
      getAsset: vi.fn(async (id: string) => id === asset.id ? asset : undefined),
    } as unknown as StorageAdapter;

    const blob = await createRecordTransferPackage(store, [record.id]);
    const parsed = await parseRecordTransferPackage(new File([blob], "records.zip", { type: "application/zip" }));

    expect(parsed.payload.records[0].contentHtml).toBe(record.contentHtml);
    expect(parsed.payload.subjects).toEqual(["数学"]);
    const parsedAsset = await parsed.readAsset(asset.id);
    expect(parsedAsset.name).toBe(asset.fileName);
    expect(parsedAsset.size).toBe(asset.size);
  });

  it("rewrites colliding resource and in-package reference IDs before staging", async () => {
    const source = makeRecord("record-source", "asset-source");
    const sourceAsset = makeAsset("asset-source");
    const staged: Asset[] = [];
    let committed: RecordBlock[] = [];
    const store = {
      listBlocks: vi.fn(async () => [makeRecord("record-source", "existing-asset")]),
      listDeletedBlocks: vi.fn(async () => []),
      getAsset: vi.fn(async (id: string) => id === "asset-source" ? makeAsset("asset-source", "old") : undefined),
      stageRecordTransferAsset: vi.fn(async (_sessionId: string, asset: Asset) => staged.push(asset)),
      commitRecordTransfer: vi.fn(async (_sessionId: string, records: RecordBlock[]) => {
        committed = records;
        return { records: 1, assets: 1, images: 1, audio: 0, attachments: 0, subjects: 1 };
      }),
      discardRecordTransfer: vi.fn(async () => undefined),
    } as unknown as StorageAdapter;

    await importRecordTransferPackage(store, transfer(source, sourceAsset), [source.id]);

    expect(committed).toHaveLength(1);
    expect(committed[0].id).not.toBe(source.id);
    expect(staged[0].id).not.toBe(sourceAsset.id);
    expect(committed[0].contentHtml).toContain(`data-asset-id="${staged[0].id}"`);
    expect(committed[0].contentHtml).toContain(`data-record-id="${committed[0].id}"`);
    expect(committed[0].assets).toEqual([{ id: staged[0].id, kind: "image", title: "图" }]);
  });

  it("cleans staged resources when cancellation happens before commit", async () => {
    const source = makeRecord("record-source", "asset-source");
    const sourceAsset = makeAsset("asset-source");
    const controller = new AbortController();
    const store = {
      listBlocks: vi.fn(async () => []),
      listDeletedBlocks: vi.fn(async () => []),
      getAsset: vi.fn(async () => undefined),
      stageRecordTransferAsset: vi.fn(async () => controller.abort()),
      commitRecordTransfer: vi.fn(),
      discardRecordTransfer: vi.fn(async () => undefined),
    } as unknown as StorageAdapter;

    await expect(importRecordTransferPackage(store, transfer(source, sourceAsset), [source.id], { signal: controller.signal }))
      .rejects.toThrow("已取消日志互通操作");

    expect(store.commitRecordTransfer).not.toHaveBeenCalled();
    expect(store.discardRecordTransfer).toHaveBeenCalledTimes(1);
  });
});
