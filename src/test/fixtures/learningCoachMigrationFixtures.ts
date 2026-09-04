export type LegacyCoachSchemaVersion = 11 | 16;

export type MigrationFixtureRow = Readonly<Record<string, unknown>>;

export interface LearningCoachMigrationFixture {
  name: string;
  schemaVersion: LegacyCoachSchemaVersion;
  stores: Readonly<Record<string, string>>;
  tables: Readonly<Record<string, readonly MigrationFixtureRow[]>>;
  expectedCounts: Readonly<Record<string, number>>;
  preserveAsFormalFacts: readonly string[];
  doNotPromoteToDecisionBlockState: readonly string[];
}

const stamp = "2026-08-30T08:00:00.000Z";

export const schema11Stores = {
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
} as const;

export const schema16Stores = {
  ...schema11Stores,
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

const coreTables = {
  blocks: [
    {
      id: "record-core-1",
      createdAt: stamp,
      updatedAt: stamp,
      type: "record",
      date: "2026-08-30",
      order: 0,
      subject: "数据结构",
      title: "BFS 队列",
      contentHtml: "<p>BFS 使用队列按层扩展结点。</p>",
      assets: [],
      formulas: [],
      mistakeRefs: [],
      tags: ["图"],
    },
  ],
  recordReviews: [
    {
      id: "record-core-1",
      recordId: "record-core-1",
      createdAt: stamp,
      updatedAt: stamp,
      status: "active",
      easeFactor: 2.5,
      repetition: 2,
      intervalDays: 6,
      nextReviewDate: "2026-09-05",
      lastReviewDate: "2026-08-30",
      consecutiveRemembered: 1,
      totalReviews: 2,
    },
  ],
  recordReviewLogs: [
    {
      id: "review-log-core-1",
      recordId: "record-core-1",
      createdAt: stamp,
      updatedAt: stamp,
      rating: "good",
      evaluationText: "出队和标记访问的先后顺序仍需确认",
      reviewedAt: stamp,
      previousEaseFactor: 2.5,
      nextEaseFactor: 2.5,
      previousRepetition: 1,
      nextRepetition: 2,
      previousIntervalDays: 1,
      nextIntervalDays: 6,
      previousNextReviewDate: "2026-08-30",
      nextReviewDate: "2026-09-05",
    },
  ],
  studySessions: [
    {
      id: "study-session-core-1",
      createdAt: stamp,
      updatedAt: stamp,
      date: "2026-08-30",
      subject: "数据结构",
      minutes: 35,
      note: "BFS 复习",
    },
  ],
} as const;

export const schema11MigrationFixture: LearningCoachMigrationFixture = {
  name: "schema-11-core-learning-data",
  schemaVersion: 11,
  stores: schema11Stores,
  tables: coreTables,
  expectedCounts: {
    blocks: 1,
    recordReviews: 1,
    recordReviewLogs: 1,
    studySessions: 1,
  },
  preserveAsFormalFacts: ["blocks", "recordReviews", "recordReviewLogs", "studySessions"],
  doNotPromoteToDecisionBlockState: ["recordReviewLogs.evaluationText"],
};

export const schema16MigrationFixture: LearningCoachMigrationFixture = {
  name: "schema-16-confirmed-coach-and-knowledge-data",
  schemaVersion: 16,
  stores: schema16Stores,
  tables: {
    ...coreTables,
    learningEvidence: [
      {
        id: "learning-evidence-confirmed-1",
        createdAt: stamp,
        updatedAt: stamp,
        date: "2026-08-30",
        occurredAt: stamp,
        subject: "数据结构",
        kind: "quiz-assessment-confirmed",
        origin: "user-confirmed-ai",
        source: { type: "ai-session", id: "ai-session-legacy-1" },
        target: { type: "record", id: "record-core-1" },
        payload: { outcome: "satisfactory", taskId: "coach-task-legacy-1" },
      },
    ],
    learningCoachSnapshots: [
      {
        id: "coach-snapshot-derived-1",
        createdAt: stamp,
        updatedAt: stamp,
        date: "2026-08-30",
        inputFingerprint: "derived-snapshot",
        ruleVersion: 4,
        generatedAt: stamp,
        summary: {},
        diagnoses: [],
        subjectStates: [],
      },
    ],
    learningCoachTasks: [
      {
        id: "coach-task-legacy-1",
        createdAt: stamp,
        updatedAt: stamp,
        snapshotId: "coach-snapshot-derived-1",
        date: "2026-08-30",
        subject: "数据结构",
        kind: "practice",
        source: "rule",
        status: "completed",
        priority: 2,
        reasonCode: "quiz-follow-up",
        title: "旧版 BFS 测验",
        recordIds: ["record-core-1"],
      },
    ],
    learningCoachAiRuns: [
      {
        id: "coach-ai-run-unselected-1",
        createdAt: stamp,
        updatedAt: stamp,
        date: "2026-08-30",
        snapshotId: "coach-snapshot-derived-1",
        inputFingerprint: "legacy-ai-input",
        issueKeys: ["quiz-follow-up:record-core-1"],
        status: "succeeded",
        sourceRecords: [],
        requestedAt: stamp,
        completedAt: stamp,
        candidateTasks: [{ title: "未采纳候选", recordIds: ["record-core-1"] }],
      },
    ],
    knowledgePoints: [
      {
        id: "knowledge-point-bfs",
        createdAt: stamp,
        updatedAt: stamp,
        subject: "数据结构",
        name: "广度优先搜索",
        normalizedKey: "广度优先搜索",
        aliases: ["BFS"],
        status: "active",
      },
      {
        id: "knowledge-point-queue",
        createdAt: stamp,
        updatedAt: stamp,
        subject: "数据结构",
        name: "队列",
        normalizedKey: "队列",
        aliases: [],
        status: "active",
      },
    ],
    recordKnowledgePointLinks: [
      {
        id: "record-kp-link-confirmed-1",
        createdAt: stamp,
        updatedAt: stamp,
        recordId: "record-core-1",
        knowledgePointId: "knowledge-point-bfs",
        role: "primary",
        recordFingerprint: "record-core-1-v1",
        confirmationSource: "manual",
        confirmedAt: stamp,
        status: "active",
      },
    ],
    knowledgeRelations: [
      {
        id: "knowledge-relation-confirmed-1",
        createdAt: stamp,
        updatedAt: stamp,
        fromKnowledgePointId: "knowledge-point-queue",
        toKnowledgePointId: "knowledge-point-bfs",
        type: "prerequisite-of",
        status: "confirmed",
        sourceRefs: [{ type: "record", id: "record-core-1" }],
        origin: "user",
        confirmedAt: stamp,
      },
    ],
    knowledgePointExtractionRuns: [
      {
        id: "knowledge-extraction-unconfirmed-1",
        createdAt: stamp,
        updatedAt: stamp,
        recordId: "record-core-1",
        subject: "数据结构",
        inputFingerprint: "legacy-record-input",
        catalogFingerprint: "legacy-catalog",
        status: "succeeded",
        requestedAt: stamp,
        completedAt: stamp,
        proposals: [{ id: "proposal-pending-1", name: "图搜索", decision: "pending" }],
      },
    ],
  },
  expectedCounts: {
    blocks: 1,
    recordReviews: 1,
    recordReviewLogs: 1,
    studySessions: 1,
    learningEvidence: 1,
    learningCoachSnapshots: 1,
    learningCoachTasks: 1,
    learningCoachAiRuns: 1,
    knowledgePoints: 2,
    recordKnowledgePointLinks: 1,
    knowledgeRelations: 1,
    knowledgePointExtractionRuns: 1,
  },
  preserveAsFormalFacts: [
    "blocks",
    "recordReviews",
    "recordReviewLogs",
    "studySessions",
    "learningEvidence:user-confirmed-ai",
    "knowledgePoints",
    "recordKnowledgePointLinks:active",
    "knowledgeRelations:confirmed",
  ],
  doNotPromoteToDecisionBlockState: [
    "recordReviewLogs.evaluationText",
    "learningEvidence.target:record",
    "learningCoachSnapshots",
    "learningCoachTasks",
    "learningCoachAiRuns.candidateTasks",
    "knowledgePointExtractionRuns.proposals:pending",
  ],
};

export const openLearningCoachMigrationFixture = (
  fixture: LearningCoachMigrationFixture,
): LearningCoachMigrationFixture => structuredClone(fixture);

export const migrationFixtureCounts = (fixture: LearningCoachMigrationFixture): Record<string, number> =>
  Object.fromEntries(Object.entries(fixture.tables).map(([table, rows]) => [table, rows.length]));
