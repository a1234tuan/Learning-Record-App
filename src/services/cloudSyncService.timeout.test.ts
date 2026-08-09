import { describe, expect, it, vi } from "vitest";
import type { CloudSyncEntity, CloudSyncExport } from "./cloudSyncModel";

// cloudSyncService.ts initializes real Firebase SDK clients (auth/firestore/storage) at module
// load time via "./firebase". Importing it directly in a test would try to reach real Firebase
// config with no network/credentials available in this environment. Mock the module so import
// succeeds without touching any actual Firebase client.
vi.mock("./firebase", () => ({
  firebaseAuth: { currentUser: null },
  firebaseStorage: {},
  firestore: {},
  googleAuthProvider: {},
}));

// withTimeout is the single mechanism behind every Firestore call site fixed in this change
// (getRemoteState, acquireLock/releaseLock, getRemoteChanges, batch commits, snapshot listing,
// etc.) — testing it directly covers all of them without mocking each call site's own dependency
// chain (db/storage/cloudSyncModel/nativeFirebaseStorage), which would make the test fragile.
const {
  cloudSyncReadRequiresConfirmation,
  cloudStorageDownloadPlanFor,
  cloudStorageSummaryFor,
  isCloudSyncOperationSuperseded,
  isUnsupportedStorageListError,
  lockMatches,
  isStaleRemoteLock,
  mapWithConcurrency,
  remoteSyncStateDocument,
  splitCloudSyncReadKeys,
  withTimeout,
} = await import("./cloudSyncService");

describe("withTimeout", () => {
  it("rejects with the given message once the timeout elapses, for a promise that never settles", async () => {
    vi.useFakeTimers();
    try {
      const neverSettles = new Promise<never>(() => undefined);
      const guarded = withTimeout(neverSettles, 20_000, "获取云同步锁超时，请确认网络可连接后重试。");

      const assertion = expect(guarded).rejects.toThrow("获取云同步锁超时，请确认网络可连接后重试。");
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reject before the timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      const neverSettles = new Promise<never>(() => undefined);
      const guarded = withTimeout(neverSettles, 20_000, "超时。");
      let settled = false;
      guarded.then(
        () => { settled = true; },
        () => { settled = true; },
      );

      await vi.advanceTimersByTimeAsync(19_999);
      expect(settled).toBe(false);

      // Let the pending timeout fire so the test doesn't leave an unhandled rejection dangling —
      // this assertion is only about "not yet" at 19999ms, not about the eventual outcome.
      await vi.advanceTimersByTimeAsync(1);
      await guarded.catch(() => undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves with the underlying value when the promise settles before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 20_000, "超时。")).resolves.toBe("ok");
  });

  it("propagates the underlying rejection unchanged when it rejects before the timeout", async () => {
    await expect(withTimeout(Promise.reject(new Error("real failure")), 20_000, "超时。")).rejects.toThrow("real failure");
  });
});

describe("mapWithConcurrency", () => {
  it("keeps concurrent network work bounded while preserving result order", async () => {
    let active = 0;
    let maximumActive = 0;
    const result = await mapWithConcurrency([0, 1, 2, 3, 4, 5, 6], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    });

    expect(maximumActive).toBe(2);
    expect(result).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });
});

describe("Android Storage list fallback classification", () => {
  it.each([403, 404, 405])("falls back for an unsupported HTTP %s response", (status) => {
    expect(isUnsupportedStorageListError(new Error(`Firebase Storage 原生列表失败（HTTP ${status}）`))).toBe(true);
  });

  it("does not hide a timeout or authentication failure behind metadata fallback", () => {
    expect(isUnsupportedStorageListError(new Error("检查云端资源超时，请检查网络连接后重试。"))).toBe(false);
    expect(isUnsupportedStorageListError(new Error("Firebase Storage 原生列表失败（HTTP 500）"))).toBe(false);
    expect(isUnsupportedStorageListError(new Error("Firebase Storage 原生列表失败（HTTP 401）"))).toBe(false);
  });
});

describe("revision-scoped lock matching", () => {
  const lock = { deviceId: "device-a", operationId: "operation-1", revision: 7, expiresAt: Date.now() + 60_000 };

  it("requires device, operation, and revision to match", () => {
    expect(lockMatches(lock, "device-a", "operation-1", 7)).toBe(true);
    expect(lockMatches(lock, "device-a", "operation-2", 7)).toBe(false);
    expect(lockMatches(lock, "device-a", "operation-1", 8)).toBe(false);
    expect(lockMatches(lock, "device-b", "operation-1", 7)).toBe(false);
  });

  it("does not treat a legacy device-only lock as the current operation", () => {
    expect(lockMatches({ deviceId: "device-a", expiresAt: Date.now() + 60_000 }, "device-a", "operation-1", 7)).toBe(false);
  });
});

describe("stale lock detection", () => {
  it("does not classify an active heartbeat as stale", () => {
    const now = 1_000_000;
    expect(isStaleRemoteLock({
      deviceId: "device-a",
      operationId: "operation-1",
      revision: 7,
      acquiredAt: now - 60_000,
      lastRenewedAt: now - 5 * 60_000,
      expiresAt: now + 20 * 60_000,
    }, now)).toBe(false);
  });

  it("classifies a lease stale only after two renewal intervals", () => {
    const now = 1_000_000;
    expect(isStaleRemoteLock({
      deviceId: "device-a",
      operationId: "operation-1",
      revision: 7,
      acquiredAt: now - 12 * 60_000,
      lastRenewedAt: now - 10 * 60_000,
      expiresAt: now + 20 * 60_000,
    }, now)).toBe(true);
  });

  it("keeps legacy locks conservative until their expiry", () => {
    const now = 1_000_000;
    expect(isStaleRemoteLock({
      deviceId: "device-a",
      operationId: "operation-1",
      revision: 7,
      expiresAt: now + 20 * 60_000,
    }, now)).toBe(false);
  });
});

describe("Firestore sync-state serialization", () => {
  it("omits an absent lock recovery record instead of writing undefined", () => {
    expect(remoteSyncStateDocument({
      protocolVersion: 2,
      headRevision: 4,
      nextRevision: 5,
      lock: null,
      storageSummary: null,
    })).toEqual({
      protocolVersion: 2,
      headRevision: 4,
      nextRevision: 5,
      lock: null,
      storageSummary: null,
    });
  });

  it("keeps only defined optional recovery fields", () => {
    expect(remoteSyncStateDocument({
      protocolVersion: 2,
      headRevision: 4,
      nextRevision: 5,
      lock: null,
      storageSummary: null,
      lastLockRecovery: {
        byDeviceId: "device-a",
        recoveredAt: 1_000,
        reason: "lease-heartbeat-stale",
      },
    })).toMatchObject({
      lastLockRecovery: {
        byDeviceId: "device-a",
        recoveredAt: 1_000,
        reason: "lease-heartbeat-stale",
      },
    });
  });
});

describe("cloud sync read budget", () => {
  it("splits targeted document ids into Firestore-safe batches of 30", () => {
    const batches = splitCloudSyncReadKeys(Array.from({ length: 61 }, (_, index) => `key-${index}`));
    expect(batches.map((batch) => batch.length)).toEqual([30, 30, 1]);
  });

  it("pauses at the expensive-read threshold unless explicitly confirmed", () => {
    const estimate = {
      mode: "full" as const,
      estimatedReads: 40_000,
      entityReads: 39_000,
      reviewEventReads: 900,
      targetedReads: 0,
      overheadReads: 100,
      storageObjectCount: 0,
      storageBytes: 0,
      storageKnown: true,
    };
    expect(cloudSyncReadRequiresConfirmation(estimate)).toBe(true);
    expect(cloudSyncReadRequiresConfirmation(estimate, true)).toBe(false);
    expect(cloudSyncReadRequiresConfirmation({ ...estimate, estimatedReads: 39_999 })).toBe(false);
  });

  it("treats an unavailable estimate as high risk", () => {
    expect(cloudSyncReadRequiresConfirmation({
      mode: "full",
      estimatedReads: Number.POSITIVE_INFINITY,
      entityReads: 0,
      reviewEventReads: 0,
      targetedReads: 0,
      overheadReads: 8,
      storageObjectCount: 0,
      storageBytes: 0,
      storageKnown: true,
    })).toBe(true);
  });

  it("requires confirmation when Storage object count or bytes crosses its threshold", () => {
    const estimate = {
      mode: "incremental" as const,
      estimatedReads: 12,
      entityReads: 2,
      reviewEventReads: 1,
      targetedReads: 1,
      overheadReads: 8,
      storageObjectCount: 500,
      storageBytes: 0,
      storageKnown: true,
    };
    expect(cloudSyncReadRequiresConfirmation(estimate)).toBe(true);
    expect(cloudSyncReadRequiresConfirmation({ ...estimate, storageObjectCount: 1, storageBytes: 100 * 1024 * 1024 })).toBe(true);
    expect(cloudSyncReadRequiresConfirmation(estimate, true)).toBe(false);
  });

  it("requires confirmation when the Storage footprint is unknown", () => {
    expect(cloudSyncReadRequiresConfirmation({
      mode: "full",
      estimatedReads: 10,
      entityReads: 1,
      reviewEventReads: 1,
      targetedReads: 0,
      overheadReads: 8,
      storageObjectCount: 0,
      storageBytes: 0,
      storageKnown: false,
    })).toBe(true);
  });
});

describe("cloud Storage summary and unknown-operation proofs", () => {
  it("deduplicates asset and large-payload objects by hash", async () => {
    const entities = [
      { key: "asset:1", entityType: "asset", entityId: "1", contentHash: "entity-1", payload: { contentHash: "asset-hash", size: 12 } },
      { key: "asset:2", entityType: "asset", entityId: "2", contentHash: "entity-2", payload: { contentHash: "asset-hash", size: 12 } },
      { key: "block:1", entityType: "block", entityId: "1", contentHash: "block-1", payload: {}, payloadDocumentHash: "document-hash", payloadByteSize: 30 },
    ] satisfies CloudSyncEntity[];
    await expect(cloudStorageSummaryFor(entities, 9)).resolves.toEqual({
      revision: 9,
      assetObjectCount: 1,
      assetBytes: 12,
      payloadObjectCount: 1,
      payloadBytes: 30,
    });
  });

  it("counts only missing local Storage objects", async () => {
    const entities = [{ key: "asset:1", entityType: "asset", entityId: "1", contentHash: "entity-1", payload: { contentHash: "asset-hash", size: 12 } }] satisfies CloudSyncEntity[];
    const local: CloudSyncExport = { entities: [], reviewEvents: [], assetBlobs: new Map<string, Blob>() };
    await expect(cloudStorageDownloadPlanFor(entities, local)).resolves.toEqual({ storageObjectCount: 1, storageBytes: 12, storageKnown: true });
  });

  it("proves an old operation is superseded only when every key is newer and visible", () => {
    const operation = { revision: 4, expectedEntities: [{ key: "block:1", contentHash: "old" }], expectedEvents: [] };
    expect(isCloudSyncOperationSuperseded(operation, { entities: [{ key: "block:1", revision: 6 }], events: [] }, 6)).toBe(true);
    expect(isCloudSyncOperationSuperseded(operation, { entities: [{ key: "block:1", revision: 4 }], events: [] }, 6)).toBe(false);
    expect(isCloudSyncOperationSuperseded(operation, { entities: [], events: [] }, 6)).toBe(false);
  });
});
