import { afterEach, describe, expect, it, vi } from "vitest";

const plugin = {
  beginDownload: vi.fn(),
  readDownloadChunk: vi.fn(),
  finishDownload: vi.fn(),
};

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
  registerPlugin: () => plugin,
}));

const { downloadNativeFirebaseStorageBlob } = await import("./nativeFirebaseStorage");

describe("downloadNativeFirebaseStorageBlob", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses the native download session cursor instead of passing a cross-bridge offset", async () => {
    plugin.beginDownload.mockResolvedValue({ sessionId: "download-1", size: 3, contentType: "text/plain" });
    plugin.readDownloadChunk
      .mockResolvedValueOnce({ base64: "YWI=", bytesRead: 2, done: false })
      .mockResolvedValueOnce({ base64: "Yw==", bytesRead: 1, done: true });
    plugin.finishDownload.mockResolvedValue(undefined);

    const blob = await downloadNativeFirebaseStorageBlob("users/user/assets/hash", "token");

    expect(blob.size).toBe(3);
    expect(blob.type).toBe("text/plain");
    expect(plugin.readDownloadChunk).toHaveBeenNthCalledWith(1, {
      sessionId: "download-1",
      length: 512 * 1024,
    });
    expect(plugin.readDownloadChunk).toHaveBeenNthCalledWith(2, {
      sessionId: "download-1",
      length: 512 * 1024,
    });
    expect(plugin.finishDownload).toHaveBeenCalledWith({ sessionId: "download-1" });
  });

  it("rejects a malformed native chunk before constructing a corrupted asset", async () => {
    plugin.beginDownload.mockResolvedValue({ sessionId: "download-2", size: 2 });
    plugin.readDownloadChunk.mockResolvedValue({ base64: "YQ==", bytesRead: 2, done: true });
    plugin.finishDownload.mockResolvedValue(undefined);

    await expect(downloadNativeFirebaseStorageBlob("users/user/assets/hash", "token"))
      .rejects.toThrow("原生 Firebase Storage 下载分块长度不一致。");
    expect(plugin.finishDownload).toHaveBeenCalledWith({ sessionId: "download-2" });
  });
});
