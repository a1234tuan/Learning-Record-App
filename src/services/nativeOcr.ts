import { Capacitor, registerPlugin } from "@capacitor/core";

import type { Asset } from "../types";
import { blobToBase64 } from "./backup";

interface NativeOcrPlugin {
  recognize(options: {
    data: string;
    fileName: string;
    mimeType: string;
    token: string;
  }): Promise<{
    jobId?: string;
    text: string;
  }>;
}

const NativeOcr = registerPlugin<NativeOcrPlugin>("NativeOcr");

export const canUseNativeOcr = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export const runNativeOcr = async (asset: Asset, token: string): Promise<{ jobId?: string; text: string }> => {
  const data = await blobToBase64(asset.data);
  return NativeOcr.recognize({
    data,
    fileName: asset.fileName,
    mimeType: asset.mimeType || "application/octet-stream",
    token,
  });
};
