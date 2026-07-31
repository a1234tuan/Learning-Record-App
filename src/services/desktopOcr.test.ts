import { afterEach, describe, expect, it, vi } from "vitest";

import type { Asset } from "../types";
import { canUseDesktopOcr, runDesktopOcr } from "./desktopOcr";

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

describe("desktop OCR adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses the Electron OCR bridge with encoded image data", async () => {
    const recognize = vi.fn(async () => ({ jobId: "job-1", text: "识别结果" }));
    vi.stubGlobal("window", { studyJournalDesktop: { isDesktop: true, ocr: { recognize } } });

    expect(canUseDesktopOcr()).toBe(true);
    await expect(runDesktopOcr(asset(), "token-1")).resolves.toEqual({ jobId: "job-1", text: "识别结果" });
    expect(recognize).toHaveBeenCalledWith({
      data: "YWJj",
      fileName: "截图.png",
      mimeType: "image/png",
      token: "token-1",
    });
  });

  it("reports an unavailable desktop OCR bridge without falling back to browser fetch", async () => {
    vi.stubGlobal("window", {});

    expect(canUseDesktopOcr()).toBe(false);
    await expect(runDesktopOcr(asset(), "token-1")).rejects.toThrow("桌面 OCR 服务尚未就绪");
  });
});
