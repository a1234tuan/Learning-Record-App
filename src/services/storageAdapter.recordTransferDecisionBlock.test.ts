import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordBlock } from "../types";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

describe("DexieStorageAdapter record transfer decision blocks", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { db } = await import("../db/database");
    const name = db.name;
    db.close();
    await Dexie.delete(name);
    vi.resetModules();
  });

  it("creates the decision-block index in the same import commit", async () => {
    const { db } = await import("../db/database");
    const { DexieStorageAdapter } = await import("./storageAdapter");
    await db.open();
    const adapter = new DexieStorageAdapter();
    const stamp = "2026-09-04T08:00:00.000Z";
    const record: RecordBlock = {
      id: "imported-record",
      createdAt: stamp,
      updatedAt: stamp,
      type: "record",
      date: "2026-09-04",
      order: 0,
      subject: "数学",
      title: "导入重点",
      contentHtml: '<record-decision-block data-decision-block-id="imported-decision" data-content-version="1"><p>队列性质</p></record-decision-block>',
      assets: [],
      formulas: [],
      mistakeRefs: [],
      tags: [],
    };

    await adapter.commitRecordTransfer("transfer-1", [record]);

    const savedRecord = await db.blocks.get(record.id);
    const indexed = await db.decisionBlocks.get("imported-decision");
    expect(savedRecord?.type === "record" ? savedRecord.contentHtml : "").toContain("data-created-at=");
    expect(indexed).toMatchObject({
      id: "imported-decision",
      recordId: record.id,
      contentVersion: 1,
      position: 0,
    });
    expect(await db.decisionBlockStates.get("imported-decision")).toMatchObject({ status: "unassessed" });
  });
});
