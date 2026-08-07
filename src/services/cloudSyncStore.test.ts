import { afterEach, describe, expect, it, vi } from "vitest";

import { CLOUD_SYNC_WATCHDOG_MS, cloudSyncStore } from "./cloudSyncStore";

describe("cloudSyncStore watchdog", () => {
  afterEach(() => {
    cloudSyncStore.setBusy(null);
    vi.useRealTimers();
  });

  it("extends the timeout whenever the sync reports progress", () => {
    vi.useFakeTimers();
    cloudSyncStore.setBusy("sync");

    vi.advanceTimersByTime(CLOUD_SYNC_WATCHDOG_MS - 1);
    cloudSyncStore.setMessage("正在下载资源 3/10。");
    vi.advanceTimersByTime(CLOUD_SYNC_WATCHDOG_MS - 1);

    expect(cloudSyncStore.getSnapshot().busy).toBe("sync");

    vi.advanceTimersByTime(1);
    expect(cloudSyncStore.getSnapshot()).toMatchObject({
      busy: null,
      message: "同步未在预期时间内完成，可能是应用被系统挂起，请重新点击同步。",
    });
  });
});
