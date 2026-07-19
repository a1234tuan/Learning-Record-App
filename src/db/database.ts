import Dexie, { type Table } from "dexie";

import type {
  AiChatAttachment,
  AiChatMessage,
  AiChatSession,
  AiSecret,
  AppSettings,
  Asset,
  Block,
  DayEntry,
  MistakeCard,
  RecordDraft,
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
  }
}

export const db = new StudyJournalDatabase();
