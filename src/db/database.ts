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
  ReviewSchedule,
  StudySession,
  Tag,
} from "../types";

export class StudyJournalDatabase extends Dexie {
  aiAttachments!: Table<AiChatAttachment, string>;
  aiSessions!: Table<AiChatSession, string>;
  aiMessages!: Table<AiChatMessage, string>;
  aiSecrets!: Table<AiSecret, string>;
  entries!: Table<DayEntry, string>;
  blocks!: Table<Block, string>;
  recordDrafts!: Table<RecordDraft, string>;
  mistakes!: Table<MistakeCard, string>;
  reviews!: Table<ReviewSchedule, string>;
  tags!: Table<Tag, string>;
  assets!: Table<Asset, string>;
  studySessions!: Table<StudySession, string>;
  settings!: Table<AppSettings, string>;

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
  }
}

export const db = new StudyJournalDatabase();
