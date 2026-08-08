import { describe, expect, it } from "vitest";

import type { CloudSyncEntityType, RecordBlock, StorageSnapshot } from "../types";
import {
  CLOUD_DOCUMENT_THRESHOLD_BYTES,
  createCloudPayloadDocument,
  exportCloudSync,
  hashValue,
  hasConflictingChanges,
  materializeCloudSyncSnapshot,
  mergeCloudSyncSmallEntity,
  mergeCloudSyncEntities,
  NON_CONFLICTING_ENTITY_TYPES,
  preserveLocalChangesForCloudWins,
  stripUpdatedAt,
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
    // contentHash must be computed the same way entity() computes it (updatedAt stripped first) —
    // createCloudPayloadDocument() re-derives the hash the same way and checks it against this value.
    large.contentHash = await hashValue(stripUpdatedAt(large.payload));

    const document = await createCloudPayloadDocument(large);
    expect(document?.hash).toBe(large.contentHash);
    expect(document?.byteSize).toBeGreaterThan(CLOUD_DOCUMENT_THRESHOLD_BYTES);

    const referenced = withCloudPayloadDocument(large, document!);
    expect(referenced.payload).toEqual({});
    expect(referenced.payloadDocumentHash).toBe(document?.hash);
  });

  it("computes the same contentHash for an entity re-saved with only updatedAt different", async () => {
    // Simulates re-saving a record where the visible content is identical but updatedAt ticked
    // forward (e.g. before the storageAdapter.ts guard runs, or any future save path that doesn't
    // itself compare old/new content). The sync layer must not see this as a real edit.
    const laterSnapshot: StorageSnapshot = {
      ...snapshot,
      payload: { ...snapshot.payload, blocks: [{ ...record, updatedAt: "2026-08-06T00:00:00.000Z" }] },
    };
    const exportedNow = await exportCloudSync(snapshot);
    const exportedLater = await exportCloudSync(laterSnapshot);
    const blockNow = exportedNow.entities.find((entity) => entity.entityType === "block");
    const blockLater = exportedLater.entities.find((entity) => entity.entityType === "block");

    expect(blockNow?.payload.updatedAt).not.toBe(blockLater?.payload.updatedAt);
    expect(blockNow?.contentHash).toBe(blockLater?.contentHash);
  });

  it("computes a different contentHash when content actually changes even with the same updatedAt", async () => {
    const editedSnapshot: StorageSnapshot = {
      ...snapshot,
      payload: { ...snapshot.payload, blocks: [{ ...record, title: "上下文切换（修订）" }] },
    };
    const exportedOriginal = await exportCloudSync(snapshot);
    const exportedEdited = await exportCloudSync(editedSnapshot);
    const blockOriginal = exportedOriginal.entities.find((entity) => entity.entityType === "block");
    const blockEdited = exportedEdited.entities.find((entity) => entity.entityType === "block");

    expect(blockOriginal?.payload.updatedAt).toBe(blockEdited?.payload.updatedAt);
    expect(blockOriginal?.contentHash).not.toBe(blockEdited?.contentHash);
  });

  it("three-way merges settings changes made to different fields", () => {
    const base = { id: "settings", examDate: "2026-12-27", theme: "system", accentColor: "#2f6f5e", lastBackupAt: "old" };
    const local = { entityType: "settings" as const, payload: { ...base, theme: "dark" }, deleted: false };
    const remote = { entityType: "settings" as const, payload: { ...base, accentColor: "#aa0000", lastBackupAt: "new" }, deleted: false };
    const result = mergeCloudSyncSmallEntity(local, remote, base);
    expect(result.conflicts).toEqual([]);
    expect(result.payload.theme).toBe("dark");
    expect(result.payload.accentColor).toBe("#aa0000");
    expect(result.payload.lastBackupAt).toBe("new");
  });

  it("reports a field conflict when both sides change the same template field", () => {
    const base = { id: "template-1", createdAt: stamp, title: "原题", contentHtml: "<p>基线</p>" };
    const local = { entityType: "template" as const, payload: { ...base, contentHtml: "<p>本机</p>" }, deleted: false };
    const remote = { entityType: "template" as const, payload: { ...base, contentHtml: "<p>云端</p>" }, deleted: false };
    expect(mergeCloudSyncSmallEntity(local, remote, base).conflicts).toEqual(["contentHtml"]);
  });

  it("applies a remote-only deletion without creating an empty live entity", () => {
    const base = { id: "template-1", createdAt: stamp, title: "原题", contentHtml: "<p>基线</p>" };
    const result = mergeCloudSyncSmallEntity(
      { entityType: "template", payload: base, deleted: false },
      { entityType: "template", payload: {}, deleted: true },
      base,
    );
    expect(result).toEqual({ payload: {}, deleted: true, conflicts: [] });
  });

  it("reports a deletion conflict when the other side edits content", () => {
    const base = { id: "template-1", createdAt: stamp, title: "原题", contentHtml: "<p>基线</p>" };
    const result = mergeCloudSyncSmallEntity(
      { entityType: "template", payload: { ...base, contentHtml: "<p>本机</p>" }, deleted: false },
      { entityType: "template", payload: {}, deleted: true },
      base,
    );
    expect(result.conflicts).toEqual(["contentHtml", "deletedAt"]);
  });

  it("treats template identity edits as conflicts and missing bases conservatively", () => {
    const base = { id: "template-1", createdAt: stamp, title: "原题", contentHtml: "<p>基线</p>" };
    const changedId = mergeCloudSyncSmallEntity(
      { entityType: "template", payload: { ...base, id: "other" }, deleted: false },
      { entityType: "template", payload: { ...base, title: "云端" }, deleted: false },
      base,
    );
    expect(changedId.conflicts).toContain("id");
    expect(mergeCloudSyncSmallEntity(
      { entityType: "settings", payload: { ...base }, deleted: false },
      { entityType: "settings", payload: { ...base, theme: "dark" }, deleted: false },
      undefined,
    ).conflicts).toEqual(["entity"]);
  });

  it("keeps local additions when choosing the cloud version", () => {
    const localAddition = {
      key: "block:local-only",
      entityType: "block" as const,
      entityId: "local-only",
      contentHash: "local-hash",
      payload: { id: "local-only" },
    };
    expect(preserveLocalChangesForCloudWins(
      [localAddition],
      [{ key: "block:cloud", entityType: "block", entityId: "cloud", contentHash: "cloud-hash", payload: { id: "cloud" } }],
      new Set(),
    )).toEqual([localAddition]);
  });

  it("does not carry a local tombstone into an unchanged cloud entity", () => {
    const localDelete = {
      key: "block:record-a",
      entityType: "block" as const,
      entityId: "record-a",
      contentHash: "deleted:old-hash",
      payload: {},
      deleted: true,
    };
    const remoteEntity = {
      key: "block:record-a",
      entityType: "block" as const,
      entityId: "record-a",
      contentHash: "old-hash",
      payload: { id: "record-a", title: "云端记录" },
    };
    expect(preserveLocalChangesForCloudWins([localDelete], [remoteEntity], new Set())).toEqual([]);
  });

  it("does not preserve a local change for a key changed by the cloud", () => {
    const localEdit = {
      key: "block:record-b",
      entityType: "block" as const,
      entityId: "record-b",
      contentHash: "local-hash",
      payload: { id: "record-b", title: "本机" },
    };
    expect(preserveLocalChangesForCloudWins([localEdit], [localEdit], new Set([localEdit.key]))).toEqual([]);
  });
});

describe("per-entity-key conflict detection", () => {
  // contentHash has no default — every call site must state whether the two sides agree or
  // disagree, so a test can't accidentally pass by relying on a hidden shared default.
  const ent = (key: string, contentHash: string, entityType: CloudSyncEntityType = "block") => ({ key, entityType, contentHash });

  const detectConflict = (
    local: { key: string; entityType: CloudSyncEntityType; contentHash: string }[],
    remote: { key: string; entityType: CloudSyncEntityType; contentHash: string }[],
  ) => {
    const normalLocal = local.filter((e) => !NON_CONFLICTING_ENTITY_TYPES.has(e.entityType));
    const normalRemote = remote.filter((e) => !NON_CONFLICTING_ENTITY_TYPES.has(e.entityType));
    return hasConflictingChanges(normalLocal, normalRemote);
  };

  it("no conflict when both sides edit entirely different entities", () => {
    expect(detectConflict([ent("block:a", "h1")], [ent("block:b", "h2")])).toBe(false);
  });

  it("conflict when the same entity key is modified on both sides with different content", () => {
    expect(detectConflict(
      [ent("block:a", "local-hash")],
      [ent("block:a", "remote-hash"), ent("block:b", "h2")],
    )).toBe(true);
  });

  it("no conflict when local has no normal changes", () => {
    expect(detectConflict([], [ent("block:a", "h1")])).toBe(false);
  });

  it("no conflict when remote has no normal changes", () => {
    expect(detectConflict([ent("block:a", "h1")], [])).toBe(false);
  });

  it("conflict when the overlapping key is not the first entry on either side", () => {
    expect(detectConflict(
      [ent("block:x", "h1"), ent("block:y", "local-y")],
      [ent("block:z", "h2"), ent("block:y", "remote-y")],
    )).toBe(true);
  });

  it("no conflict when only settings is touched on both sides (e.g. autoBackup bookkeeping)", () => {
    expect(detectConflict(
      [ent("settings:settings", "local-settings", "settings")],
      [ent("settings:settings", "remote-settings", "settings")],
    )).toBe(false);
  });

  it("no conflict when only review-state/review-day-stat overlap on both sides", () => {
    expect(detectConflict(
      [ent("review-state:r1", "local-1", "review-state"), ent("review-day-stat:2026-08-05", "local-2", "review-day-stat")],
      [ent("review-state:r1", "remote-1", "review-state"), ent("review-day-stat:2026-08-05", "remote-2", "review-day-stat")],
    )).toBe(false);
  });

  it("still conflicts on a real content overlap even if settings also overlaps", () => {
    expect(detectConflict(
      [ent("block:a", "local-a"), ent("settings:settings", "local-settings", "settings")],
      [ent("block:a", "remote-a"), ent("settings:settings", "remote-settings", "settings")],
    )).toBe(true);
  });

  it("no conflict when the same key has matching hashes on both sides (self-heal after an interrupted publish)", () => {
    // Targets the publish() reordering fix: headRevision can advance before this device's own
    // ledger write for that same publish completes. The next sync then sees its own upload
    // reflected back as a "remote change" with an identical hash — not a real edit conflict, and
    // it must fall through to the normal merge/download path so the ledger gets re-derived.
    expect(detectConflict(
      [ent("block:a", "same-hash")],
      [ent("block:a", "same-hash")],
    )).toBe(false);
  });

  it("conflict when the same key has different hashes on both sides (a genuine concurrent edit)", () => {
    expect(detectConflict(
      [ent("block:a", "local-hash")],
      [ent("block:a", "remote-hash")],
    )).toBe(true);
  });
});
