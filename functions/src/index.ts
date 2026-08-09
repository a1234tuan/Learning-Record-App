import { getStorage } from "firebase-admin/storage";
import { initializeApp } from "firebase-admin/app";
import * as functions from "firebase-functions/v1";
import { logger } from "firebase-functions";

import { summarizeStorageFiles } from "./storageUsage";

initializeApp();

const storage = getStorage();

export const getStorageUsage = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "请先登录 Firebase 账号。");
    }

    const bucket = storage.bucket();
    const prefix = `users/${context.auth.uid}/`;
    try {
      // Restrict the result to the signed-in account. This keeps one user's
      // storage footprint private while still including snapshots and orphaned
      // objects that the active sync revision does not reference.
      const [files] = await bucket.getFiles({ prefix, autoPaginate: true });
      const { usedBytes, objectCount } = summarizeStorageFiles(files);

      return {
        bucketName: bucket.name,
        prefix,
        usedBytes,
        objectCount,
        measuredAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Failed to measure Firebase Storage usage", error);
      throw new functions.https.HttpsError("internal", "读取 Firebase Storage 用量失败，请稍后重试。");
    }
  });
