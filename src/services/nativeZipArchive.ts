import { Capacitor, registerPlugin } from "@capacitor/core";

export interface NativeZipExportDestination {
  kind: "cache-share" | "auto-latest";
}

interface NativeZipArchivePlugin {
  beginExport(options: {
    destination: NativeZipExportDestination["kind"];
    fileName: string;
    mimeType: string;
  }): Promise<{ sessionId: string; uri?: string; folderName?: string }>;
  beginEntry(options: { sessionId: string; path: string }): Promise<void>;
  appendEntry(options: { sessionId: string; data: string }): Promise<void>;
  finishEntry(options: { sessionId: string }): Promise<void>;
  finishExport(options: { sessionId: string }): Promise<{ uri: string; size: number; folderName?: string }>;
  cancelExport(options: { sessionId: string }): Promise<void>;
  beginImport(options: { path: string }): Promise<{ sessionId: string; entries: string[] }>;
  readEntry(options: { sessionId: string; path: string }): Promise<{ data: string }>;
  readEntryChunk(options: { sessionId: string; path: string; offset: number; length: number }): Promise<{
    data: string;
    bytesRead: number;
    done: boolean;
  }>;
  finishImport(options: { sessionId: string }): Promise<void>;
  cancelImport(options: { sessionId: string }): Promise<void>;
}

export const NativeZipArchive = registerPlugin<NativeZipArchivePlugin>("NativeZipArchive");

export const canUseNativeZipArchive = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
