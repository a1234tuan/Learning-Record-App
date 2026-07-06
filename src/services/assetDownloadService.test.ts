import { beforeEach, describe, expect, it, vi } from "vitest";
import { Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

import type { Asset } from "../types";
import { downloadAsset, sanitizeFileName } from "./assetDownloadService";

vi.mock("@capacitor/filesystem", () => ({
  Directory: {
    Cache: "CACHE",
    Documents: "DOCUMENTS",
  },
  Filesystem: {
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    deleteFile: vi.fn(),
    getUri: vi.fn(),
  },
}));

vi.mock("@capacitor/share", () => ({
  Share: {
    share: vi.fn(),
  },
}));

vi.mock("file-saver", () => ({
  saveAs: vi.fn(),
}));

vi.mock("../lib/platform", () => ({
  isNativePlatform: () => true,
}));

describe("sanitizeFileName", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(Filesystem.writeFile).mockImplementation(async (options) => ({
      uri: `file:///cache/${options.path}`,
    }));
    vi.mocked(Filesystem.appendFile).mockResolvedValue(undefined);
    vi.mocked(Filesystem.deleteFile).mockResolvedValue(undefined);
    vi.mocked(Filesystem.getUri).mockImplementation(async (options) => ({
      uri: `file:///cache/${options.path}`,
    }));
    vi.mocked(Share.share).mockResolvedValue({});
  });

  it("removes path separators and invalid filename characters", () => {
    expect(sanitizeFileName("a/b\\c:*?\"<>|.pdf")).toBe("a_b_c_.pdf");
  });

  it("falls back when filename is empty", () => {
    expect(sanitizeFileName("   ")).toMatch(/^asset-/);
  });

  it("shares native assets from cache instead of public Documents", async () => {
    const asset: Asset = {
      id: "asset-1",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
      fileName: "photo.png",
      title: "图片",
      mimeType: "image/png",
      size: 5,
      kind: "image",
      data: new Blob(["photo"], { type: "image/png" }),
    };

    const result = await downloadAsset(asset);

    expect(result).toBe("已打开系统保存/分享面板。");
    expect(Filesystem.writeFile).toHaveBeenCalledWith(expect.objectContaining({
      path: "shared-exports/photo.png",
      directory: "CACHE",
    }));
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({
      files: ["file:///cache/shared-exports/photo.png"],
    }));
  });
});
