import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset } from "../types";

const { nativeOcr, desktopOcr, settings } = vi.hoisted(() => ({
  nativeOcr: {
    canUseNativeOcr: vi.fn(),
    runNativeOcr: vi.fn(),
  },
  desktopOcr: {
    canUseDesktopOcr: vi.fn(),
    runDesktopOcr: vi.fn(),
  },
  settings: {
    getPaddleOcrToken: vi.fn(),
  },
}));

vi.mock("./nativeOcr", () => nativeOcr);
vi.mock("./desktopOcr", () => desktopOcr);
vi.mock("./ocrSettings", () => settings);

import { runPaddleOcr } from "./ocrService";

const asset = (): Asset => ({
  id: "asset-1",
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  kind: "image",
  fileName: "截图.png",
  mimeType: "image/png",
  size: 3,
  data: new Blob(["abc"], { type: "image/png" }),
});

describe("runPaddleOcr platform routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.getPaddleOcrToken.mockResolvedValue("token-1");
    nativeOcr.canUseNativeOcr.mockReturnValue(false);
    desktopOcr.canUseDesktopOcr.mockReturnValue(false);
  });

  it("uses the Electron bridge on Windows desktop", async () => {
    desktopOcr.canUseDesktopOcr.mockReturnValue(true);
    desktopOcr.runDesktopOcr.mockResolvedValue({ jobId: "job-1", text: "桌面识别文本" });
    const onProgress = vi.fn();

    await expect(runPaddleOcr(asset(), onProgress)).resolves.toBe("桌面识别文本");
    expect(nativeOcr.runNativeOcr).not.toHaveBeenCalled();
    expect(desktopOcr.runDesktopOcr).toHaveBeenCalledWith(expect.objectContaining({ id: "asset-1" }), "token-1");
    expect(onProgress).toHaveBeenCalledWith({ ocrStatus: "queued", ocrError: undefined });
    expect(onProgress).toHaveBeenCalledWith({ ocrStatus: "running" });
    expect(onProgress).toHaveBeenCalledWith({ ocrJobId: "job-1" });
  });

  it("keeps the Android native OCR path unchanged", async () => {
    nativeOcr.canUseNativeOcr.mockReturnValue(true);
    nativeOcr.runNativeOcr.mockResolvedValue({ jobId: "job-android", text: "Android 识别文本" });

    await expect(runPaddleOcr(asset())).resolves.toBe("Android 识别文本");
    expect(desktopOcr.runDesktopOcr).not.toHaveBeenCalled();
  });

  it("continues to reject browser OCR without a server proxy", async () => {
    await expect(runPaddleOcr(asset())).rejects.toThrow("Web 端 OCR 需要服务器代理");
  });
});
