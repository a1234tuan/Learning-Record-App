import type { Asset } from "../types";
import { isDesktopPlatform } from "../lib/platform";
import { blobToBase64 } from "./backup";

const desktopOcr = () => window.studyJournalDesktop?.ocr;

const requireDesktopOcr = () => {
  const ocr = desktopOcr();
  if (!ocr) {
    throw new Error("桌面 OCR 服务尚未就绪，请重新打开应用后重试。");
  }
  return ocr;
};

export const canUseDesktopOcr = (): boolean =>
  isDesktopPlatform() && Boolean(desktopOcr());

export const runDesktopOcr = async (asset: Asset, token: string): Promise<{ jobId?: string; text: string }> => {
  if (asset.kind !== "image") {
    throw new Error("OCR 只支持图片资源。");
  }
  return requireDesktopOcr().recognize({
    data: await blobToBase64(asset.data),
    fileName: asset.fileName,
    mimeType: asset.mimeType || "application/octet-stream",
    token,
  });
};
