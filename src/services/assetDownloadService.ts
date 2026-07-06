import { Share } from "@capacitor/share";
import { saveAs } from "file-saver";

import type { Asset } from "../types";
import { isNativePlatform } from "../lib/platform";
import { normalizeNativeShareError, writeBlobToNativeShareCache } from "./nativeFileWriter";

export const sanitizeFileName = (fileName: string): string => {
  const cleaned = fileName.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned || `asset-${Date.now()}`;
};

export const downloadAsset = async (asset: Asset): Promise<string> => {
  const fileName = sanitizeFileName(asset.fileName || asset.title || "asset");

  if (!isNativePlatform()) {
    saveAs(asset.data, fileName);
    return "已开始下载。";
  }

  const writeResult = await writeBlobToNativeShareCache({
    blob: asset.data,
    fileName,
    mimeType: asset.mimeType || asset.data.type || "application/octet-stream",
  });

  try {
    await Share.share({
      title: asset.title ?? fileName,
      text: `导出文件：${fileName}`,
      files: [writeResult.uri],
      dialogTitle: "保存或分享文件",
    });
  } catch (error) {
    throw normalizeNativeShareError(error);
  }

  return "已打开系统保存/分享面板。";
};
