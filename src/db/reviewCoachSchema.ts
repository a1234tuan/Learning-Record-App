import type { Transaction } from "dexie";

import type {
  CoachMigrationBackup,
  LegacyKnowledgePoint,
  LegacyKnowledgeRelation,
  LegacyLearningEvidence,
  LegacyRecordKnowledgePointLink,
} from "../features/reviewCoach/domain";

export const LEGACY_SCHEMA_16_STORES = {
  entries: "id, date, updatedAt, pinned, favorite",
  blocks: "id, date, type, order, updatedAt",
  templates: "id, title, updatedAt, createdAt",
  recordDrafts: "id, recordId, updatedAt",
  recordReviews: "id, recordId, status, nextReviewDate, lastReviewDate, updatedAt, [status+nextReviewDate]",
  recordReviewLogs: "id, recordId, reviewedAt, rating",
  recordReviewDayStats: "id, date, updatedAt, completedAt",
  mistakes: "id, subject, chapter, mastery, nextReviewAt, updatedAt, pinned, favorite",
  reviews: "id, mistakeId, dueAt, completedAt, stage",
  tags: "id, &name, parent",
  assets: "id, kind, fileName, updatedAt, generatedBy",
  studySessions: "id, date, subject, blockId",
  settings: "id",
  aiSessions: "id, sourceDate, updatedAt, createdAt",
  aiMessages: "id, sessionId, role, createdAt, updatedAt",
  aiAttachments: "id, sessionId, messageId, createdAt, updatedAt",
  aiSecrets: "id",
  restoreStagingAssets: "stagingId, sessionId, asset.id",
  knowledgePodcasts: "id, updatedAt, createdAt, scriptStatus, audioStatus",
  cloudSyncState: "id, userId",
  cloudSyncLedger: "id, entityType, cloudRevision",
  cloudSyncOperations: "id, operationId, userId, status, revision, updatedAt",
  cloudSyncMutation: "id",
  autoBackupState: "id",
  learningCoachSettings: "id",
  learningEvidence: "id, date, occurredAt, kind, subject, updatedAt",
  learningCoachSnapshots: "id, &date, updatedAt",
  learningCoachTasks: "id, date, status, snapshotId, issueKey, activeSlotKey, replanKey, knowledgePointId, updatedAt, [date+status]",
  learningCoachAiRuns: "id, date, status, snapshotId, requestedAt, updatedAt",
  knowledgePoints: "id, subject, status, normalizedKey, [subject+normalizedKey], updatedAt",
  recordKnowledgePointLinks: "id, recordId, knowledgePointId, status, [recordId+status], [knowledgePointId+status], updatedAt",
  knowledgePointExtractionRuns: "id, recordId, status, requestedAt, inputFingerprint, updatedAt",
  knowledgePointCoachSnapshots: "id, &date, updatedAt",
  knowledgeRelations: "id, fromKnowledgePointId, toKnowledgePointId, status, type, updatedAt, [fromKnowledgePointId+status], [toKnowledgePointId+status]",
} as const;

export const REVIEW_COACH_SCHEMA_17_STORES = {
  ...LEGACY_SCHEMA_16_STORES,
  decisionBlocks: "id, recordId, contentVersion, updatedAt, deletedAt, [recordId+deletedAt]",
  decisionBlockArchives: "id, decisionBlockId, recordId, contentVersion, archivedAt, &idempotencyKey, deletedAt",
  decisionBlockFeedback: "id, decisionBlockId, recordId, contentVersion, reviewLogId, occurredAt, &idempotencyKey, deletedAt, [decisionBlockId+contentVersion]",
  feedbackInterpretations: "id, &feedbackId, decisionBlockId, contentVersion, status, updatedAt, deletedAt",
  analysisQueueItems: "id, &feedbackId, decisionBlockId, contentVersion, status, batchId, updatedAt, deletedAt",
  analysisBatches: "id, status, requestedAt, &idempotencyKey, updatedAt, deletedAt",
  sessionBlueprints: "id, batchId, decisionBlockId, contentVersion, status, &idempotencyKey, updatedAt, deletedAt",
  adaptiveReviewTasks: "id, &blueprintId, decisionBlockId, contentVersion, status, &activeSlotKey, &openTargetKey, &idempotencyKey, updatedAt, deletedAt",
  adaptiveQuizTurns: "id, taskId, sequence, status, &idempotencyKey, &[taskId+sequence], displayedAt, updatedAt, deletedAt",
  taskOutcomeEvents: "id, taskId, turnId, decisionBlockId, contentVersion, kind, occurredAt, &idempotencyKey, deletedAt",
  delayedVerifications: "id, &sourceOutcomeEventId, decisionBlockId, contentVersion, status, verificationDueAt, &idempotencyKey, updatedAt, deletedAt",
  decisionBlockStates: "id, status, contentVersion, currentTaskId, pendingVerificationId, updatedAt",
  interventionEffectSummaries: "id, problemType, practiceType, evidenceStatus, updatedAt",
  aiRoleConfigs: "id, &role, providerId, updatedAt, deletedAt",
  coachMigrationBackups: "id, sourceVersion, createdAt",
} as const;

const tableRows = async <T>(transaction: Transaction, name: string): Promise<T[]> => {
  if (!transaction.db.tables.some((table) => table.name === name)) return [];
  return transaction.table<T, string>(name).toArray();
};

export const buildSchema17MigrationBackup = async (transaction: Transaction): Promise<CoachMigrationBackup> => {
  const [
    blocks,
    recordReviews,
    recordReviewLogs,
    studySessions,
    learningEvidence,
    knowledgePoints,
    recordKnowledgePointLinks,
    knowledgeRelations,
  ] = await Promise.all([
    tableRows<Record<string, unknown>>(transaction, "blocks"),
    tableRows<Record<string, unknown>>(transaction, "recordReviews"),
    tableRows<Record<string, unknown>>(transaction, "recordReviewLogs"),
    tableRows<Record<string, unknown>>(transaction, "studySessions"),
    tableRows<LegacyLearningEvidence>(transaction, "learningEvidence"),
    tableRows<LegacyKnowledgePoint>(transaction, "knowledgePoints"),
    tableRows<LegacyRecordKnowledgePointLink>(transaction, "recordKnowledgePointLinks"),
    tableRows<LegacyKnowledgeRelation>(transaction, "knowledgeRelations"),
  ]);
  const confirmedEvidence = learningEvidence.filter((item) => item.origin === "user-confirmed-ai" || item.kind.endsWith("-confirmed"));
  const activeLinks = recordKnowledgePointLinks.filter((item) => item.status === "active");
  const confirmedRelations = knowledgeRelations.filter((item) => item.status === "confirmed");
  const hasLegacyCoachFacts = learningEvidence.length > 0 || knowledgePoints.length > 0 || recordKnowledgePointLinks.length > 0 || knowledgeRelations.length > 0;
  return {
    id: "schema-17",
    sourceVersion: hasLegacyCoachFacts ? 16 : 11,
    createdAt: new Date().toISOString(),
    coreCounts: {
      blocks: blocks.length,
      recordReviews: recordReviews.length,
      recordReviewLogs: recordReviewLogs.length,
      studySessions: studySessions.length,
    },
    legacyLearningEvidence: confirmedEvidence,
    legacyKnowledgePoints: knowledgePoints,
    legacyRecordKnowledgePointLinks: activeLinks,
    legacyKnowledgeRelations: confirmedRelations,
  };
};

export const migrateToReviewCoachSchema17 = async (transaction: Transaction) => {
  const backup = await buildSchema17MigrationBackup(transaction);
  await transaction.table<CoachMigrationBackup, string>("coachMigrationBackups").put(backup);
  // Old Coach projections remain read-only. No record-level comment, candidate,
  // or unconfirmed extraction proposal is promoted into a block-level fact.
};
