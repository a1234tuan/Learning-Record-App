import { describe, expect, it } from "vitest";

import type { CloudSyncEntityType, RecordBlock, StorageSnapshot } from "../types";
import {
  CLOUD_DOCUMENT_THRESHOLD_BYTES,
  createCloudPayloadDocument,
  exportCloudSync,
  hashValue,
  materializeCloudSyncSnapshot,
  mergeCloudSyncEntities,
  NON_CONFLICTING_ENTITY_TYPES,
  withCloudPayloadDocument,
} from "./cloudSyncModel";

const stamp = "2026-08-05T00:00:00.000Z";

const record: RecordBlock = {
  id: "record-1",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-08-05",
  order: 0,
  subject: "OS",
  title: "进程",
  contentHtml: "<p>上下文切换</p>",
  assets: [{ id: "asset-1", title: "diagram", kind: "image" }],
  formulas: [],
  mistakeRefs: [],
  tags: ["重点"],
};

const snapshot: StorageSnapshot = {
  payload: {
    manifest: {
      format: "study-journal",
      version: 5,
      exportedAt: stamp,
      appVersion: "0.1.0",
      counts: { entries: 0, blocks: 1, mistakes: 0, assets: 1, tags: 0, reviews: 0, studySessions: 0 },
    },
    entries: [],
    blocks: [record],
    templates: [],
    recordDrafts: [],
    mistakes: [],
    tags: [],
    reviews: [],
    recordReviews: [],
    recordReviewLogs: [],
    recordReviewDayStats: [],
    studySessions: [],
    settings: {
      id: "settings",
      examDate: "2026-12-27",
      theme: "system",
      accentColor: "#2f6f5e",
      backupReminderDays: 7,
      fontScale: 1,
      lineHeight: 1.7,
      subjects: [],
      schemaVersion: 4,
    },
  },
  assets: [{
    id: "asset-1",
    createdAt: stamp,
    updatedAt: stamp,
    fileName: "diagram.png",
    mimeType: "image/png",
    size: 12,
    kind: "image",
    data: new Blob(["diagram-data"], { type: "image/png" }),
  }],
};

describe("cloud sync model", () => {
  it("keeps asset bytes out of entity payloads and restores them by content hash", async () => {
    const exported = await exportCloudSync(snapshot);
    const asset = exported.entities.find((entity) => entity.entityType === "asset");

    expect(asset?.payload.data).toBeUndefined();
    expect(typeof asset?.payload.contentHash).toBe("string");
    expect(exported.assetBlobs.size).toBe(1);

    const restored = materializeCloudSyncSnapshot(exported.entities, exported.reviewEvents, exported.assetBlobs);
    expect(restored.assets[0].data).toBe(snapshot.assets[0].data);
    expect(restored.payload.blocks).toEqual([record]);
  });

  it("does not restore an entity marked as deleted by the cloud", async () => {
    const exported = await exportCloudSync(snapshot);
    const block = exported.entities.find((entity) => entity.entityType === "block");
    if (!block) throw new Error("expected block entity");

    const merged = mergeCloudSyncEntities(exported.entities, [{ ...block, deleted: true, payload: {} }]);
    const restored = materializeCloudSyncSnapshot(merged, exported.reviewEvents, exported.assetBlobs);

    expect(restored.payload.blocks).toEqual([]);
  });

  it("moves oversized structured payloads into a content-addressed document reference", async () => {
    const exported = await exportCloudSync(snapshot);
    const block = exported.entities.find((entity) => entity.entityType === "block");
    if (!block) throw new Error("expected block entity");
    const large = { ...block, payload: { ...block.payload, contentHtml: "x".repeat(CLOUD_DOCUMENT_THRESHOLD_BYTES + 1) } };
    large.contentHash = await hashValue(large.payload);

    const document = await createCloudPayloadDocument(large);
    expect(document?.hash).toBe(large.contentHash);
    expect(document?.byteSize).toBeGreaterThan(CLOUD_DOCUMENT_THRESHOLD_BYTES);

    const referenced = withCloudPayloadDocument(large, document!);
    expect(referenced.payload).toEqual({});
    expect(referenced.payloadDocumentHash).toBe(document?.hash);
  });
});

describe("per-entity-key conflict detection", () => {
  const ent = (key: string, entityType: CloudSyncEntityType = "block") => ({ key, entityType });

  const detectConflict = (local: { key: string; entityType: CloudSyncEntityType }[], remote: { key: string; entityType: CloudSyncEntityType }[]) => {
    const normalLocal = local.filter((e) => !NON_CONFLICTING_ENTITY_TYPES.has(e.entityType));
    const normalRemote = remote.filter((e) => !NON_CONFLICTING_ENTITY_TYPES.has(e.entityType));
    const localKeys = new Set(normalLocal.map((e) => e.key));
    return normalLocal.length > 0 && normalRemote.some((e) => localKeys.has(e.key));
  };

  it("no conflict when both sides edit entirely different entities", () => {
    expect(detectConflict([ent("block:a")], [ent("block:b")])).toBe(false);
  });

  it("conflict when the same entity key is modified on both sides", () => {
    expect(detectConflict([ent("block:a")], [ent("block:a"), ent("block:b")])).toBe(true);
  });

  it("no conflict when local has no normal changes", () => {
    expect(detectConflict([], [ent("block:a")])).toBe(false);
  });

  it("no conflict when remote has no normal changes", () => {
    expect(detectConflict([ent("block:a")], [])).toBe(false);
  });

  it("conflict when the overlapping key is not the first entry on either side", () => {
    expect(detectConflict(
      [ent("block:x"), ent("block:y")],
      [ent("block:z"), ent("block:y")],
    )).toBe(true);
  });

  it("no conflict when only settings is touched on both sides (e.g. autoBackup bookkeeping)", () => {
    expect(detectConflict(
      [ent("settings:settings", "settings")],
      [ent("settings:settings", "settings")],
    )).toBe(false);
  });

  it("no conflict when only review-state/review-day-stat overlap on both sides", () => {
    expect(detectConflict(
      [ent("review-state:r1", "review-state"), ent("review-day-stat:2026-08-05", "review-day-stat")],
      [ent("review-state:r1", "review-state"), ent("review-day-stat:2026-08-05", "review-day-stat")],
    )).toBe(false);
  });

  it("still conflicts on a real content overlap even if settings also overlaps", () => {
    expect(detectConflict(
      [ent("block:a"), ent("settings:settings", "settings")],
      [ent("block:a"), ent("settings:settings", "settings")],
    )).toBe(true);
  });
});
