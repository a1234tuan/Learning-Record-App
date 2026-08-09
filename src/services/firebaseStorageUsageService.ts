import { httpsCallable } from "firebase/functions";

import { firebaseFunctions } from "./firebase";

export interface FirebaseStorageUsage {
  bucketName: string;
  prefix: string;
  usedBytes: number;
  objectCount: number;
  measuredAt: string;
}

type StorageUsageResponse = Partial<FirebaseStorageUsage>;

const readStorageUsage = httpsCallable<void, StorageUsageResponse>(firebaseFunctions, "getStorageUsage", {
  timeout: 120_000,
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const getFirebaseStorageUsage = async (): Promise<FirebaseStorageUsage> => {
  const result = await readStorageUsage();
  const data: unknown = result.data;
  if (!isRecord(data)
    || typeof data.bucketName !== "string"
    || typeof data.prefix !== "string"
    || typeof data.usedBytes !== "number"
    || !Number.isFinite(data.usedBytes)
    || data.usedBytes < 0
    || !Number.isInteger(data.objectCount)
    || typeof data.objectCount !== "number"
    || data.objectCount < 0
    || typeof data.measuredAt !== "string") {
    throw new Error("Firebase Storage 用量接口返回了无效数据。");
  }
  return {
    bucketName: data.bucketName,
    prefix: data.prefix,
    usedBytes: data.usedBytes,
    objectCount: data.objectCount,
    measuredAt: data.measuredAt,
  };
};
