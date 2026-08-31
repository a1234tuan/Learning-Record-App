import { describe, expect, it } from "vitest";

import type { LearningCoachTask, LearningEvidence, RecordBlock, RecordKnowledgePointLink, RecordReviewLog } from "../types";
import { cleanDuplicateLearningCoachTasks, evaluateLearningCoachTask, resolveLearningCoachCandidateWorkflow, skipLearningCoachTask, startLearningCoachTask } from "./learningCoachTaskService";

const stamp = "2026-08-28T08:00:00.000Z";
const task = (patch: Partial<LearningCoachTask> = {}): LearningCoachTask => ({
  id: "task-1", createdAt: stamp, updatedAt: stamp, snapshotId: "snapshot-1", date: "2026-08-28", subject: "计网",
  kind: "practice", source: "rule", status: "pending", priority: 2, reasonCode: "subject-gap", title: "回顾 IPv4", recordIds: ["record-1"], ...patch,
});

describe("learningCoachTaskService", () => {
  it("does not complete a task until its real action result exists", () => {
    const started = startLearningCoachTask(task(), stamp);
    expect(evaluateLearningCoachTask({ task: started, records: [], reviewLogs: [], evidence: [] }).complete).toBe(false);
    const evidence: LearningEvidence = {
      id: "confirmed", createdAt: stamp, updatedAt: stamp, date: "2026-08-28", occurredAt: "2026-08-28T09:00:00.000Z",
      kind: "quiz-assessment-confirmed", origin: "user-confirmed-ai", source: { type: "ai-session", id: "session" }, target: { type: "record", id: "record-1" }, payload: { taskId: "task-1", outcome: "satisfactory" },
    };
    expect(evaluateLearningCoachTask({ task: started, records: [], reviewLogs: [], evidence: [evidence] }).complete).toBe(true);
  });

  it("tracks formal review progress from ReviewLog facts", () => {
    const started = startLearningCoachTask(task({ reasonCode: "review-overdue", kind: "review", recordIds: ["r1", "r2"] }), stamp);
    const log = { id: "log-1", recordId: "r1", reviewedAt: "2026-08-28T09:00:00.000Z" } as RecordReviewLog;
    const result = evaluateLearningCoachTask({ task: started, records: [], reviewLogs: [log], evidence: [] });
    expect(result.complete).toBe(false);
    expect(result.task.progress).toEqual({ current: 1, total: 2 });
    expect(result.supportingEvidenceRefs).toEqual([{ type: "review-log", id: "log-1" }]);
  });

  it("completes create-record only after meaningful content is saved", () => {
    const started = startLearningCoachTask(task({ recordIds: [] }), stamp, "new-record");
    const base: RecordBlock = { id: "new-record", createdAt: stamp, updatedAt: "2026-08-28T09:00:00.000Z", type: "record", date: "2026-08-28", order: 0, subject: "计网", title: "IPv4", contentHtml: "", assets: [], formulas: [], mistakeRefs: [], tags: [] };
    expect(evaluateLearningCoachTask({ task: started, records: [{ ...base, contentHtml: "<p></p>" }], reviewLogs: [], evidence: [] }).complete).toBe(false);
    expect(evaluateLearningCoachTask({ task: started, records: [{ ...base, title: "只有标题", contentHtml: "<p> &nbsp; </p>" }], reviewLogs: [], evidence: [] }).complete).toBe(false);
    expect(evaluateLearningCoachTask({ task: started, records: [{ ...base, contentHtml: "<p>IPv4 分片规则</p>" }], reviewLogs: [], evidence: [] }).complete).toBe(true);
  });

  it("adds the formal KnowledgePoint link requirement only to a corrective point Record task", () => {
    const corrective = startLearningCoachTask(task({
      scope: "knowledge-point",
      knowledgePointId: "kp-1",
      reasonCode: "kp-assessment-needs-review",
      recordIds: [],
      action: { type: "create-record", subject: "计网", recordIds: [], knowledgePointId: "kp-1" },
      completionPolicy: { type: "meaningful-record-with-knowledge-point-link", knowledgePointId: "kp-1" },
    }), stamp, "correction");
    const savedRecord: RecordBlock = { id: "correction", createdAt: stamp, updatedAt: "2026-08-28T09:00:00.000Z", type: "record", date: "2026-08-28", order: 0, subject: "计网", title: "纠错", contentHtml: "<p>重新推导子网划分。</p>", assets: [], formulas: [], mistakeRefs: [], tags: [] };
    const formalLink: RecordKnowledgePointLink = { id: "link-1", createdAt: "2026-08-28T09:01:00.000Z", updatedAt: "2026-08-28T09:01:00.000Z", recordId: savedRecord.id, knowledgePointId: "kp-1", role: "primary", recordFingerprint: "fp", confirmationSource: "manual", confirmedAt: "2026-08-28T09:01:00.000Z", status: "active" };
    expect(evaluateLearningCoachTask({ task: corrective, records: [savedRecord], reviewLogs: [], evidence: [], knowledgePointLinks: [] }).complete).toBe(false);
    const completed = evaluateLearningCoachTask({ task: corrective, records: [savedRecord], reviewLogs: [], evidence: [], knowledgePointLinks: [formalLink] });
    expect(completed.complete).toBe(true);
    expect(completed.supportingEvidenceRefs).toEqual([{ type: "record", id: savedRecord.id }, { type: "record-knowledge-point-link", id: formalLink.id }]);

    const ordinary = startLearningCoachTask(task({ recordIds: [] }), stamp, savedRecord.id);
    expect(evaluateLearningCoachTask({ task: ordinary, records: [savedRecord], reviewLogs: [], evidence: [], knowledgePointLinks: [] }).complete).toBe(true);
  });

  it("keeps one executed active task and cancels only redundant active rows idempotently", () => {
    const duplicate = (id: string, createdAt: string, patch: Partial<LearningCoachTask> = {}) => task({ id, createdAt, updatedAt: createdAt, ...patch });
    const completed = duplicate("history", "2026-08-27T08:00:00.000Z", { status: "completed", completedAt: stamp });
    const initial = [
      duplicate("old-pending", "2026-08-28T07:00:00.000Z"),
      duplicate("executed", "2026-08-28T07:30:00.000Z", { status: "in-progress", startedAt: "2026-08-28T07:45:00.000Z" }),
      duplicate("new-pending", "2026-08-28T07:50:00.000Z"),
      completed,
    ];
    const first = cleanDuplicateLearningCoachTasks({ tasks: initial, evidence: [], reviewLogs: [], records: [], cleanedAt: stamp });
    expect(first).toMatchObject({ duplicateGroups: 1, cancelled: 2 });
    expect(first.tasks.find((item) => item.id === "executed")).toMatchObject({ status: "in-progress", activeSlotKey: "subject-gap:计网" });
    expect(first.tasks.filter((item) => item.status === "cancelled")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "old-pending", duplicateOfTaskId: "executed", cancellationReason: "duplicate-active-task", cleanupVersion: 1 }),
      expect.objectContaining({ id: "new-pending", duplicateOfTaskId: "executed", cancellationReason: "duplicate-active-task", cleanupVersion: 1 }),
    ]));
    expect(initial.find((item) => item.id === "history")).toEqual(completed);

    const afterFirst = [completed, ...first.tasks];
    const second = cleanDuplicateLearningCoachTasks({ tasks: afterFirst, evidence: [], reviewLogs: [], records: [], cleanedAt: "2026-08-28T10:00:00.000Z" });
    expect(second).toMatchObject({ duplicateGroups: 0, cancelled: 0 });
    expect(second.tasks).toHaveLength(1);
    expect(second.tasks[0]).toMatchObject({ id: "executed", status: "in-progress" });
  });

  it("records skip replanning policy", () => {
    expect(skipLearningCoachTask(task(), "not-relevant", stamp).deferredUntil).toBe("2026-09-04");
    expect(skipLearningCoachTask(task(), "too-large", stamp).deferredUntil).toBe("2026-08-28");
  });

  it("keeps an accepted AI action and its completion policy consistent", () => {
    const review = resolveLearningCoachCandidateWorkflow({
      kind: "practice", title: "复习 IPv4", reason: "逾期", subject: "计网", recordIds: ["r1"],
      action: { type: "review-queue", subject: "计网", recordIds: ["r1"] },
    });
    expect(review.kind).toBe("review");
    expect(review.action.type).toBe("review-queue");
    expect(review.completionPolicy.type).toBe("review-logs");

    const quiz = resolveLearningCoachCandidateWorkflow({
      kind: "review", title: "测验 IPv4", reason: "薄弱", subject: "计网", recordIds: ["r1"],
      action: { type: "ai-quiz", subject: "计网", recordIds: ["r1"] },
    });
    expect(quiz.kind).toBe("practice");
    expect(quiz.completionPolicy.type).toBe("confirmed-quiz");
  });
});
