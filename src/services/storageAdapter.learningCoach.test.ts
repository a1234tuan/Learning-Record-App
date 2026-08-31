import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiChatSession, KnowledgePointCoachSnapshot, KnowledgePointExtractionRun, KnowledgeRelation, LearningCoachAiRun, LearningCoachSnapshot, LearningCoachTask, RecordBlock } from "../types";
import { recordKnowledgeFingerprint } from "../lib/knowledgePointIdentity";

const stamp = "2026-06-21T00:00:00.000Z";

class Table<T extends { id: string }> {
  rows = new Map<string, T>();
  async get(id: string) { return this.rows.get(id); }
  async put(value: T) { this.rows.set(value.id, value); return value.id; }
  async delete(id: string) { this.rows.delete(id); }
  async bulkDelete(ids: string[]) { ids.forEach((id) => this.rows.delete(id)); }
  async toArray() { return [...this.rows.values()]; }
  async count() { return this.rows.size; }
  filter(predicate: (row: T) => boolean) { return { toArray: async () => [...this.rows.values()].filter(predicate) }; }
  orderBy(_field: string) { return { reverse: () => ({ toArray: async () => [...this.rows.values()] }) }; }
  where(field: string) { return { equals: (value: unknown) => {
    const fields = field.startsWith("[") ? field.slice(1, -1).split("+") : [field];
    const expected = Array.isArray(value) ? value : [value];
    const matches = [...this.rows.values()].filter((row) => fields.every((key, index) => row[key as keyof T] === expected[index]));
    return {
      first: async () => matches[0],
      toArray: async () => matches,
      count: async () => matches.length,
      filter: (predicate: (row: T) => boolean) => ({ first: async () => matches.find(predicate), toArray: async () => matches.filter(predicate) }),
    };
  } }; }
}

const task = (patch: Partial<LearningCoachTask> = {}): LearningCoachTask => ({
  id: "task-1", createdAt: stamp, updatedAt: stamp, snapshotId: "snapshot-1", date: "2026-06-21",
  kind: "practice", source: "rule", status: "pending", priority: 2, reasonCode: "subject-gap", title: "数学练习", recordIds: [],
  ...patch,
});

describe("DexieStorageAdapter local learning coach isolation", () => {
  afterEach(() => {
    vi.doUnmock("../db/database");
    vi.resetModules();
  });

  it("does not create a cloud mutation for coach-only writes", async () => {
    vi.resetModules();
    const learningCoachSettings = new Table();
    const learningEvidence = new Table();
    const learningCoachTasks = new Table<LearningCoachTask>();
    const learningCoachSnapshots = new Table<LearningCoachSnapshot>();
    const aiSessions = new Table<AiChatSession>();
    const learningCoachAiRuns = new Table<LearningCoachAiRun>();
    const recordReviewLogs = new Table();
    const blocks = new Table();
    const knowledgePoints = new Table();
    const recordKnowledgePointLinks = new Table();
    const knowledgePointExtractionRuns = new Table<KnowledgePointExtractionRun>();
    const knowledgePointCoachSnapshots = new Table<KnowledgePointCoachSnapshot>();
    const knowledgeRelations = new Table<KnowledgeRelation>();
    const cloudSyncMutation = { get: vi.fn(async () => ({ id: "local" as const, epoch: 7 })), put: vi.fn() };
    const fakeDb = {
      learningCoachSettings, learningEvidence, learningCoachTasks, learningCoachSnapshots, learningCoachAiRuns, aiSessions, recordReviewLogs, blocks, knowledgePoints, recordKnowledgePointLinks, knowledgePointExtractionRuns, knowledgePointCoachSnapshots, knowledgeRelations, cloudSyncMutation,
      transaction: async (_mode: string, ...args: unknown[]) => (args.at(-1) as () => Promise<unknown>)(),
    };
    vi.doMock("../db/database", () => ({ db: fakeDb }));
    const { DexieStorageAdapter } = await import("./storageAdapter");
    const adapter = new DexieStorageAdapter();
    await adapter.saveLearningCoachSettings({ id: "learning-coach", scenario: "general", dashboardEnabled: true, updatedAt: stamp });
    await adapter.saveLearningCoachTask(task());
    await adapter.updateLearningCoachTaskStatus("task-1", "skipped");
    await adapter.saveLearningCoachSnapshot({
      id: "snapshot-1", createdAt: stamp, updatedAt: stamp, date: "2026-06-21", scenario: "general", inputFingerprint: "coach-input",
      localSummary: { dueReviews: 0, overdueReviews: 0, pendingTasks: 1, studyMinutesLast7Days: 0, recordCountLast7Days: 0 }, diagnoses: [], taskIds: ["task-1"],
    });
    await adapter.saveAiSession({
      id: "quiz-session", createdAt: stamp, updatedAt: stamp, title: "本地单题测验",
      coachQuiz: { taskId: "task-1", recordIds: [], contextFingerprint: "coach-input" },
    });
    await adapter.saveLearningCoachAiRun({
      id: "run-1", createdAt: stamp, updatedAt: stamp, date: "2026-06-21", snapshotId: "snapshot-1", inputFingerprint: "coach-input",
      issueKeys: [], status: "succeeded", sourceRecords: [], requestedAt: stamp, completedAt: stamp, analysis: "本地 AI 结果",
    });
    const record: RecordBlock = { id: "record-1", createdAt: stamp, updatedAt: stamp, type: "record", date: "2026-06-21", order: 0, subject: "计网", title: "IPv4", contentHtml: "<p>子网掩码用于划分网络位。</p>", assets: [], formulas: [], mistakeRefs: [], tags: [] };
    await blocks.put(record);
    const formal = await adapter.createKnowledgePointLink({ recordId: record.id, subject: record.subject, name: "IPv4 子网划分", confirmationSource: "manual" });
    const secondRecord: RecordBlock = { ...record, id: "record-2", title: "IPv4 分片" };
    await blocks.put(secondRecord);
    const second = await adapter.createKnowledgePointLink({ recordId: secondRecord.id, subject: secondRecord.subject, name: "IPv4 分片", confirmationSource: "manual" });
    await adapter.saveKnowledgeRelation({ id: "relation-1", createdAt: stamp, updatedAt: stamp, fromKnowledgePointId: formal.knowledgePoint.id, toKnowledgePointId: second.knowledgePoint.id, type: "prerequisite-of", status: "confirmed", sourceRefs: [{ type: "knowledge-point", id: formal.knowledgePoint.id }], origin: "user", confirmedAt: stamp });
    expect(await adapter.listKnowledgeRelations()).toHaveLength(1);
    await adapter.saveKnowledgePointExtractionRun({ id: "kp-run", createdAt: stamp, updatedAt: stamp, recordId: record.id, subject: record.subject, inputFingerprint: recordKnowledgeFingerprint(record), catalogFingerprint: "catalog-fp", status: "succeeded", requestedAt: stamp, completedAt: stamp, proposals: [{ id: "proposal-1", name: "子网掩码", normalizedKey: "子网掩码", sourceQuote: "子网掩码", decision: "pending" }] });
    const decided = await adapter.decideKnowledgePointProposal("kp-run", "proposal-1", "accepted");
    expect(decided?.proposals[0]).toMatchObject({ decision: "accepted", createdKnowledgePointId: expect.any(String), createdLinkId: expect.any(String) });
    await adapter.saveKnowledgePointCoachSnapshot({ id: "kp-snapshot", createdAt: stamp, updatedAt: stamp, date: "2026-06-21", evaluatedAt: stamp, inputFingerprint: "kp-fp", states: [{ knowledgePointId: formal.knowledgePoint.id, subject: "计网", linkedRecordIds: [record.id], dueReviewRecordIds: [], overdueReviewRecordIds: [] }], diagnoses: [], taskIds: [] });
    await adapter.saveLearningCoachTask(task({ id: "task-2", status: "in-progress", startedAt: stamp, progress: { current: 1, total: 1 } }));
    await adapter.completeLearningCoachTask("task-2", "completed", {
      id: "evidence-1", createdAt: stamp, updatedAt: stamp, date: "2026-06-21", occurredAt: stamp,
      kind: "task-outcome", origin: "local", source: { type: "coach-task", id: "task-2" }, payload: {},
      supportingEvidenceRefs: [{ type: "record", id: "record-1" }],
    });
    await learningCoachTasks.put(task({ id: "duplicate-1" }));
    await learningCoachTasks.put(task({ id: "duplicate-2" }));
    const cleanup = await adapter.cleanupDuplicateLearningCoachTasks();
    expect(cleanup.cancelled).toBeGreaterThan(0);
    expect(await learningCoachTasks.get("task-2")).toMatchObject({ status: "completed", progress: { current: 1, total: 1 }, completionEvidenceRefs: [{ type: "record", id: "record-1" }] });
    expect(cloudSyncMutation.get).not.toHaveBeenCalled();
    expect(cloudSyncMutation.put).not.toHaveBeenCalled();
  });

  it("serializes repeated task creation into one active issue slot and one replan", async () => {
    vi.resetModules();
    const learningCoachTasks = new Table<LearningCoachTask>();
    let transactionTail = Promise.resolve<unknown>(undefined);
    const fakeDb = {
      learningCoachTasks,
      transaction: (_mode: string, ...args: unknown[]) => {
        const callback = args.at(-1) as () => Promise<unknown>;
        const run = transactionTail.then(callback, callback);
        transactionTail = run.catch(() => undefined);
        return run;
      },
    };
    vi.doMock("../db/database", () => ({ db: fakeDb }));
    const { DexieStorageAdapter } = await import("./storageAdapter");
    const adapter = new DexieStorageAdapter();
    const attempts = Array.from({ length: 50 }, (_, index) => task({
      id: `task-${index}`,
      activeSlotKey: undefined,
      replanKey: "skipped-task:too-large",
      parentTaskId: "skipped-task",
    }));
    const saved = await Promise.all(attempts.map((item) => adapter.saveLearningCoachTask(item)));
    expect(new Set(saved.map((item) => item.id))).toEqual(new Set(["task-0"]));
    expect((await learningCoachTasks.toArray()).filter((item) => item.status === "pending" || item.status === "in-progress")).toHaveLength(1);
  });
});
