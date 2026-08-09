import { beforeEach, describe, expect, it, vi } from "vitest";

const { callable, firebaseFunctions } = vi.hoisted(() => ({
  callable: vi.fn(),
  firebaseFunctions: {},
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => callable),
}));

vi.mock("./firebase", () => ({ firebaseFunctions }));

const { getFirebaseStorageUsage } = await import("./firebaseStorageUsageService");

describe("getFirebaseStorageUsage", () => {
  beforeEach(() => callable.mockReset());

  it("returns the validated server measurement", async () => {
    callable.mockResolvedValueOnce({
      data: {
        bucketName: "study-journal-408-9f31.firebasestorage.app",
        prefix: "users/user-1/",
        usedBytes: 384,
        objectCount: 2,
        measuredAt: "2026-08-09T00:00:00.000Z",
      },
    });

    await expect(getFirebaseStorageUsage()).resolves.toEqual({
      bucketName: "study-journal-408-9f31.firebasestorage.app",
      prefix: "users/user-1/",
      usedBytes: 384,
      objectCount: 2,
      measuredAt: "2026-08-09T00:00:00.000Z",
    });
  });

  it("rejects a malformed server response", async () => {
    callable.mockResolvedValueOnce({ data: { usedBytes: 384 } });

    await expect(getFirebaseStorageUsage()).rejects.toThrow("返回了无效数据");
  });
});
