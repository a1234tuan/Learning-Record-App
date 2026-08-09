export interface StorageFileLike {
  metadata?: {
    size?: unknown;
  };
}

export interface StorageUsageSummary {
  usedBytes: number;
  objectCount: number;
}

/** Sum the live objects returned by Cloud Storage without trusting metadata blindly. */
export const summarizeStorageFiles = (files: readonly StorageFileLike[]): StorageUsageSummary => {
  let usedBytes = 0;

  for (const file of files) {
    const size = file.metadata?.size;
    const bytes = typeof size === "number" ? size : Number(size ?? 0);
    if (Number.isFinite(bytes) && bytes >= 0) usedBytes += bytes;
  }

  return { usedBytes, objectCount: files.length };
};
