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
const { withTimeout } = await import("./cloudSyncService");

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
