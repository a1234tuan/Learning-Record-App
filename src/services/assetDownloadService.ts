import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { saveAs } from "file-saver";

import type { Asset } from "../types";
import { blobToBase64 } from "./backup";
import { isNativePlatform } from "../lib/platform";

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

  const base64 = await blobToBase64(asset.data);
  const writeResult = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Documents,
    recursive: true,
  });

  await Share.share({
    title: asset.title ?? fileName,
    text: `导出文件：${fileName}`,
    files: [writeResult.uri],
    dialogTitle: "保存或分享文件",
  });

  return "已打开系统保存/分享面板。";
};
