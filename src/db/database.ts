import Dexie, { type Table } from "dexie";

import type {
  AiChatAttachment,
  AiChatMessage,
  AiChatSession,
  AiSecret,
  AppSettings,
  Asset,
  AutoBackupStateRecord,
  CloudSyncLedgerRecord,
  CloudSyncOperationRecord,
  CloudSyncMutationRecord,
  CloudSyncStateRecord,
  Block,
  ContentTemplate,
  DayEntry,
  KnowledgePodcast,
  KnowledgePoint,
  KnowledgePointCoachSnapshot,
  KnowledgePointExtractionRun,
  KnowledgeRelation,
  LearningCoachSettings,
  LearningCoachAiRun,
  LearningCoachSnapshot,
  LearningCoachTask,
  LearningEvidence,
  MistakeCard,
  RecordDraft,
  RecordKnowledgePointLink,
  RecordReviewDayStat,
  RecordReviewLog,
  RecordReviewState,
  ReviewSchedule,
  StudySession,
  Tag,
} from "../types";

export interface RestoreStagingAsset {
  stagingId: string;
  sessionId: string;
  asset: Asset;
}

export class StudyJournalDatabase extends Dexie {
  aiAttachments!: Table<AiChatAttachment, string>;
  aiSessions!: Table<AiChatSession, string>;
  aiMessages!: Table<AiChatMessage, string>;
  aiSecrets!: Table<AiSecret, string>;
  entries!: Table<DayEntry, string>;
  blocks!: Table<Block, string>;
  templates!: Table<ContentTemplate, string>;
  recordDrafts!: Table<RecordDraft, string>;
  recordReviews!: Table<RecordReviewState, string>;
  recordReviewLogs!: Table<RecordReviewLog, string>;
  recordReviewDayStats!: Table<RecordReviewDayStat, string>;
  mistakes!: Table<MistakeCard, string>;
  reviews!: Table<ReviewSchedule, string>;
  tags!: Table<Tag, string>;
  assets!: Table<Asset, string>;
  studySessions!: Table<StudySession, string>;
  settings!: Table<AppSettings, string>;
  restoreStagingAssets!: Table<RestoreStagingAsset, string>;
  knowledgePodcasts!: Table<KnowledgePodcast, string>;
  /** These tables are intentionally local-only and excluded from cloud sync exports. */
  learningCoachSettings!: Table<LearningCoachSettings, string>;
  learningEvidence!: Table<LearningEvidence, string>;
  learningCoachSnapshots!: Table<LearningCoachSnapshot, string>;
  learningCoachTasks!: Table<LearningCoachTask, string>;
  learningCoachAiRuns!: Table<LearningCoachAiRun, string>;
  /** Phase 2 KnowledgePoint tables are local-only and are never enumerated by cloud sync. */
  knowledgePoints!: Table<KnowledgePoint, string>;
  recordKnowledgePointLinks!: Table<RecordKnowledgePointLink, string>;
  knowledgePointExtractionRuns!: Table<KnowledgePointExtractionRun, string>;
  knowledgePointCoachSnapshots!: Table<KnowledgePointCoachSnapshot, string>;
  /** Phase 3 decision-layer relations are local-only and excluded from cloud sync. */
  knowledgeRelations!: Table<KnowledgeRelation, string>;
  cloudSyncState!: Table<CloudSyncStateRecord, string>;
  cloudSyncLedger!: Table<CloudSyncLedgerRecord, string>;
  cloudSyncOperations!: Table<CloudSyncOperationRecord, string>;
  cloudSyncMutation!: Table<CloudSyncMutationRecord, string>;
  autoBackupState!: Table<AutoBackupStateRecord, string>;

  constructor() {
    super("study-journal-408");
    this.version(1).stores({
      entries: "id, date, updatedAt, pinned, favorite",
      blocks: "id, date, type, order, updatedAt",
      mistakes: "id, subject, chapter, mastery, nextReviewAt, updatedAt, pinned, favorite",
      reviews: "id, mistakeId, dueAt, completedAt, stage",
      tags: "id, &name, parent",
      assets: "id, kind, fileName, updatedAt",
      studySessions: "id, date, subject, blockId",
      settings: "id",
    });
    this.version(2).stores({
      entries: "id, date, updatedAt, pinned, favorite",
      blocks: "id, date, type, order, updatedAt",
      mistakes: "id, subject, chapter, mastery, nextReviewAt, updatedAt, pinned, favorite",
      reviews: "id, mistakeId, dueAt, completedAt, stage",
      tags: "id, &name, parent",
      assets: "id, kind, fileName, updatedAt",
      studySessions: "id, date, subject, blockId",
      settings: "id",
      aiSessions: "id, sourceDate, updatedAt, createdAt",
      aiMessages: "id, sessionId, role, createdAt, updatedAt",
      aiSecrets: "id",
    });
    this.version(3).stores({
      entries: "id, date, updatedAt, pinned, favorite",
      blocks: "id, date, type, order, updatedAt",
      recordDrafts: "id, recordId, updatedAt",
      mistakes: "id, subject, chapter, mastery, nextReviewAt, updatedAt, pinned, favorite",
      reviews: "id, mistakeId, dueAt, completedAt, stage",
      tags: "id, &name, parent",
      assets: "id, kind, fileName, updatedAt",
      studySessions: "id, date, subject, blockId",
      settings: "id",
      aiSessions: "id, sourceDate, updatedAt, createdAt",
      aiMessages: "id, sessionId, role, createdAt, updatedAt",
      aiSecrets: "id",
    });
    this.version(4).stores({
      entries: "id, date, updatedAt, pinned, favorite",
      blocks: "id, date, type, order, updatedAt",
      recordDrafts: "id, recordId, updatedAt",
      mistakes: "id, subject, chapter, mastery, nextReviewAt, updatedAt, pinned, favorite",
      reviews: "id, mistakeId, dueAt, completedAt, stage",
      tags: "id, &name, parent",
      assets: "id, kind, fileName, updatedAt",
      studySessions: "id, date, subject, blockId",
      settings: "id",
      aiSessions: "id, sourceDate, updatedAt, createdAt",
      aiMessages: "id, sessionId, role, createdAt, updatedAt",
      aiAttachments: "id, sessionId, messageId, createdAt, updatedAt",
      aiSecrets: "id",
    });
    this.version(5).stores({
      entries: "id, date, updatedAt, pinned, favorite",
      blocks: "id, date, type, order, updatedAt",
      recordDrafts: "id, recordId, updatedAt",
      recordReviews: "id, recordId, status, nextReviewDate, lastReviewDate, updatedAt, [status+nextReviewDate]",
      recordReviewLogs: "id, recordId, reviewedAt, rating",
      recordReviewDayStats: "id, date, updatedAt, completedAt",
      mistakes: "id, subject, chapter, mastery, nextReviewAt, updatedAt, pinned, favorite",
      reviews: "id, mistakeId, dueAt, completedAt, stage",
      tags: "id, &name, parent",
      assets: "id, kind, fileName, updatedAt",
      studySessions: "id, date, subject, blockId",
      settings: "id",
      aiSessions: "id, sourceDate, updatedAt, createdAt",
      aiMessages: "id, sessionId, role, createdAt, updatedAt",
      aiAttachments: "id, sessionId, messageId, createdAt, updatedAt",
      aiSecrets: "id",
    });
    this.version(6).stores({
      entries: "id, date, updatedAt, pinned, favorite",
      blocks: "id, date, type, order, updatedAt",
      recordDrafts: "id, recordId, updatedAt",
      recordReviews: "id, recordId, status, nextReviewDate, lastReviewDate, updatedAt, [status+nextReviewDate]",
      recordReviewLogs: "id, recordId, reviewedAt, rating",
      recordReviewDayStats: "id, date, updatedAt, completedAt",
      mistakes: "id, subject, chapter, mastery, nextReviewAt, updatedAt, pinned, favorite",
      reviews: "id, mistakeId, dueAt, completedAt, stage",
      tags: "id, &name, parent",
      assets: "id, kind, fileName, updatedAt",
      studySessions: "id, date, subject, blockId",
      settings: "id",
      aiSessions: "id, sourceDate, updatedAt, createdAt",
      aiMessages: "id, sessionId, role, createdAt, updatedAt",
      aiAttachments: "id, sessionId, messageId, createdAt, updatedAt",
      aiSecrets: "id",
      restoreStagingAssets: "stagingId, sessionId, asset.id",
    });
    this.version(7).stores({
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
      assets: "id, kind, fileName, updatedAt",
      studySessions: "id, date, subject, blockId",
      settings: "id",
      aiSessions: "id, sourceDate, updatedAt, createdAt",
      aiMessages: "id, sessionId, role, createdAt, updatedAt",
      aiAttachments: "id, sessionId, messageId, createdAt, updatedAt",
      aiSecrets: "id",
      restoreStagingAssets: "stagingId, sessionId, asset.id",
    });
    this.version(8).stores({
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
    });
    this.version(9).stores({
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
    });
    this.version(10).stores({
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
      autoBackupState: "id",
    });
    this.version(11).stores({
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
    });
    this.version(12).stores({
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
      learningCoachTasks: "id, date, status, snapshotId, updatedAt, [date+status]",
    });
    this.version(13).stores({
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
      learningCoachTasks: "id, date, status, snapshotId, updatedAt, [date+status]",
      learningCoachAiRuns: "id, date, status, snapshotId, requestedAt, updatedAt",
    });
    this.version(14).stores({
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
      // These indexes intentionally remain non-unique: v14 must be able to open
      // databases already polluted by the duplicate-task bug before cleanup runs.
      learningCoachTasks: "id, date, status, snapshotId, issueKey, activeSlotKey, replanKey, updatedAt, [date+status]",
      learningCoachAiRuns: "id, date, status, snapshotId, requestedAt, updatedAt",
    });
    this.version(15).stores({
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
    });
    this.version(16).stores({
      knowledgeRelations: "id, fromKnowledgePointId, toKnowledgePointId, status, type, updatedAt, [fromKnowledgePointId+status], [toKnowledgePointId+status]",
    });
  }
}

export const db = new StudyJournalDatabase();
