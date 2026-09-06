import type { RecordBlock, RecordReviewLog, RecordReviewState } from "../types";
import { db } from "../db/database";
import { storage } from "../services/storageAdapter";
import { addDaysISO, nowISO, todayISO } from "../lib/date";
import { createBaseEntity } from "../lib/entity";
import { isDesktopPlatform, isNativePlatform } from "../lib/platform";

const PREVIEW_RECORD_ID = "stage3-preview-record";
const PREVIEW_DECISION_BLOCK_ID = "stage3-preview-decision-block";
const PREVIEW_SUBJECT = "数据结构";

const yesterdayDateTime = (): string => `${addDaysISO(todayISO(), -1)}T09:00:00.000Z`;

const previewRecord = (): RecordBlock => {
  const stamp = nowISO();
  return {
    id: PREVIEW_RECORD_ID,
    createdAt: stamp,
    updatedAt: stamp,
    type: "record",
    date: todayISO(),
    order: 0,
    subject: PREVIEW_SUBJECT,
    title: "BFS Stage3 Preview",
    contentHtml: `<p>Record context</p><record-decision-block data-decision-block-id="${PREVIEW_DECISION_BLOCK_ID}" data-content-version="1" data-created-at="${stamp}" data-updated-at="${stamp}"><p>BFS queue insertion and visited marking</p></record-decision-block><p>After block</p>`,
    assets: [],
    formulas: [],
    mistakeRefs: [],
    tags: ["stage3"],
  };
};

/** Seeds only the local browser preview requested for Stage 3 UI acceptance. */
export const seedStage3Preview = async (): Promise<void> => {
  await storage.initialize();
  await storage.getOrCreateEntry(todayISO());

  const existing = await db.blocks.get(PREVIEW_RECORD_ID);
  if (!existing || existing.type !== "record") {
    await storage.saveBlock(previewRecord());
  }

  let review = await storage.getRecordReview(PREVIEW_RECORD_ID);
  if (!review) {
    await storage.addRecordToReview(PREVIEW_RECORD_ID);
    review = await storage.getRecordReview(PREVIEW_RECORD_ID);
  }

  const ratingLogs = await storage.listRecordReviewLogs(PREVIEW_RECORD_ID);
  if (!ratingLogs.some((log) => log.eventType === "rating")) {
    const reviewedAt = yesterdayDateTime();
    const log: RecordReviewLog = {
      ...createBaseEntity(),
      recordId: PREVIEW_RECORD_ID,
      rating: "forgot",
      eventType: "rating",
      normalizedRating: "forgot",
      reviewKind: "overview",
      scheduler: "overview-v1",
      evaluationText: "Old evaluation context",
      reviewedAt,
      previousEaseFactor: 2.5,
      nextEaseFactor: 2.3,
      previousRepetition: 0,
      nextRepetition: 0,
      previousIntervalDays: 1,
      nextIntervalDays: 1,
      nextReviewDate: todayISO(),
      previousConsecutiveRemembered: 0,
      previousTotalReviews: 0,
      updatedAt: reviewedAt,
    };
    await db.recordReviewLogs.put(log);
    try {
      await db.decisionBlockFeedback.put({
        ...createBaseEntity(),
        id: "stage3-preview-feedback",
        decisionBlockId: PREVIEW_DECISION_BLOCK_ID,
        recordId: PREVIEW_RECORD_ID,
        contentVersion: 1,
        reviewLogId: log.id,
        comment: "I mark visited too late",
        includeInAnalysis: true,
        source: "review",
        occurredAt: reviewedAt,
        idempotencyKey: "feedback:stage3-preview-feedback",
      });
      await db.analysisQueueItems.put({
        ...createBaseEntity(),
        id: "stage3-preview-queue-item",
        decisionBlockId: PREVIEW_DECISION_BLOCK_ID,
        recordId: PREVIEW_RECORD_ID,
        contentVersion: 1,
        feedbackId: "stage3-preview-feedback",
        status: "eligible",
        eligibilityReason: "user-feedback",
      });
    } catch (error) {
      console.error("Stage 3 preview feedback initialization failed", error);
    }
  }

  const seededReview: RecordReviewState = {
    ...(await db.recordReviews.get(PREVIEW_RECORD_ID) ?? review ?? {
      id: PREVIEW_RECORD_ID,
      recordId: PREVIEW_RECORD_ID,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      easeFactor: 2.5,
      repetition: 0,
      intervalDays: 1,
      consecutiveRemembered: 0,
      totalReviews: 0,
    }),
    status: "active",
    reviewKind: "overview",
    scheduler: "overview-v1",
    lastReviewDate: undefined,
    lastReviewedAt: undefined,
    nextReviewDate: addDaysISO(todayISO(), -1),
    updatedAt: nowISO(),
  };
  await db.recordReviews.put({
    ...seededReview,
    nextReviewDate: addDaysISO(todayISO(), -1),
    fsrsCard: seededReview.fsrsCard
      ? { ...seededReview.fsrsCard, dueDate: todayISO() }
      : undefined,
  });
  const projectionLogs = await db.recordReviewLogs.where("recordId").equals(PREVIEW_RECORD_ID).toArray();
  for (const log of projectionLogs) {
    if (!log.stateAfter) continue;
    await db.recordReviewLogs.put({ ...log, stateAfter: seededReview });
  }
};

export const isStage3PreviewRequest = (): boolean => {
  if (typeof window === "undefined") return false;
  if (isNativePlatform() || isDesktopPlatform()) return false;
  const host = window.location.hostname;
  return (host === "127.0.0.1" || host === "localhost")
    && new URLSearchParams(window.location.search).get("preview") === "stage3";
};
