import { describe, expect, it, vi } from "vitest";

import { flushDesktopPendingChanges, registerDesktopFlushHandler } from "./desktopLifecycleService";

describe("desktop lifecycle flush handlers", () => {
  it("waits for all registered handlers and isolates one handler failure", async () => {
    const complete = vi.fn();
    const unregisterComplete = registerDesktopFlushHandler(async () => {
      complete();
    });
    const unregisterFailure = registerDesktopFlushHandler(async () => {
      throw new Error("write failed");
    });

    await expect(flushDesktopPendingChanges()).resolves.toBeUndefined();
    expect(complete).toHaveBeenCalledTimes(1);

    unregisterComplete();
    unregisterFailure();
  });
});
