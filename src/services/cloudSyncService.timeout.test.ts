import { describe, expect, it, vi } from "vitest";

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
const { isUnsupportedStorageListError, lockMatches, mapWithConcurrency, withTimeout } = await import("./cloudSyncService");

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
