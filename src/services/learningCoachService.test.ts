import { describe, expect, it } from "vitest";

import type { LearningCoachSettings, LearningCoachTask, LearningEvidence, RecordBlock, RecordReviewState } from "../types";
import { buildLearningCoachProjection } from "./learningCoachService";

const stamp = "2026-06-21T09:00:00.000Z";
const settings: LearningCoachSettings = { id: "learning-coach", scenario: "general", dashboardEnabled: true, updatedAt: stamp };
const record = (patch: Partial<RecordBlock> = {}): RecordBlock => ({
  id: "record-1", createdAt: stamp, updatedAt: stamp, type: "record", date: "2026-06-21", order: 0,
  subject: "数学", title: "极限", contentHtml: "<p>极限</p>", assets: [], formulas: [], mistakeRefs: [], tags: [], ...patch,
});
const review = (patch: Partial<RecordReviewState> = {}): RecordReviewState => ({
  id: "record-1", recordId: "record-1", createdAt: stamp, updatedAt: stamp, status: "active", easeFactor: 2.5,
  repetition: 1, intervalDays: 1, consecutiveRemembered: 0, totalReviews: 0, nextReviewDate: "2026-06-20", ...patch,
});
const projection = (patch: Partial<Parameters<typeof buildLearningCoachProjection>[0]> = {}) => buildLearningCoachProjection({
  today: "2026-06-21", settings, records: [record()], studySessions: [], reviews: [], evidence: [], tasks: [], ...patch,
});

describe("learningCoachService", () => {
  it("uses the same input to produce a stable local fingerprint and tasks", () => {
    const first = projection();
    const second = projection();
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
    expect(first.tasks).toEqual(second.tasks);
  });

  it("keeps Phase 1 projection unchanged when only KnowledgePoint coach data changes", () => {
    const plain = projection();
    const withPointData = projection({
      evidence: [{ id: "kp-evidence", createdAt: stamp, updatedAt: stamp, date: "2026-06-21", occurredAt: stamp, kind: "quiz-assessment-confirmed", origin: "user-confirmed-ai", source: { type: "ai-session", id: "kp-session" }, target: { type: "knowledge-point", id: "kp-1" }, payload: { outcome: "needs-review" } }],
      tasks: [{ id: "kp-task", createdAt: stamp, updatedAt: stamp, snapshotId: "kp-snapshot", date: "2026-06-21", subject: "数学", kind: "practice", source: "rule", status: "pending", priority: 2, reasonCode: "kp-assessment-needs-review", title: "知识点验证", recordIds: ["record-1"], scope: "knowledge-point", knowledgePointId: "kp-1", issueKey: "kp:kp-1:kp-assessment-needs-review" }],
    });
    expect(withPointData.inputFingerprint).toBe(plain.inputFingerprint);
    expect(withPointData.diagnoses).toEqual(plain.diagnoses);
    expect(withPointData.tasks).toEqual(plain.tasks);
  });

  it("keeps a new diagnosis stable across identical recalculations", () => {
    const first = projection({ records: [record({ date: "2026-06-17" })], evaluatedAt: "2026-06-21T09:00:00.000Z" });
    const second = projection({ records: [record({ date: "2026-06-17" })], previousDiagnoses: first.diagnoses, evaluatedAt: "2026-06-21T10:00:00.000Z" });
    expect(second.diagnoses.find((item) => item.issueKey === "subject-gap:数学")?.status).toBe("new");
  });

  it("creates an overdue review task before other diagnostics", () => {
    const result = projection({ reviews: [review()] });
    expect(result.diagnoses[0]?.code).toBe("review-overdue");
    expect(result.tasks[0]).toMatchObject({ kind: "review", reasonCode: "review-overdue", priority: 1 });
  });

  it("reports a subject gap exactly after three full inactive days", () => {
    const result = projection({ records: [record({ date: "2026-06-17" })] });
    expect(result.diagnoses).toEqual(expect.arrayContaining([expect.objectContaining({ code: "subject-gap", subject: "数学" })]));
  });

  it("does not let an unconfirmed AI outcome create a quiz follow-up", () => {
    const result = projection({ evidence: [{
      id: "e-1", createdAt: stamp, updatedAt: stamp, date: "2026-06-21", occurredAt: stamp, kind: "quiz-answer", origin: "local",
      source: { type: "ai-session", id: "session" }, target: { type: "record", id: "record-1" }, payload: { outcome: "needs-review" },
    }] });
    expect(result.diagnoses.some((diagnosis) => diagnosis.code === "quiz-follow-up")).toBe(false);
  });

  it("canonicalizes legacy exam subject aliases in diagnoses and tasks", () => {
    const result = projection({
      settings: { ...settings, scenario: "postgraduate-exam", postgraduateExamProfile: { examDate: "2027-12-01", weeklyAvailableMinutes: 600, stages: { 数学: "基础", 政治: "基础", 英语: "基础", 408: "基础" } } },
      records: [record({ id: "os-1", subject: "操作系统", date: "2026-06-17", title: "进程" }), record({ id: "arch-1", subject: "组成原理", date: "2026-06-17", title: "流水线" }), record({ id: "net-1", subject: "计算机网络", date: "2026-06-17", title: "IPv4" })],
    });
    expect(result.diagnoses.filter((item) => item.code === "subject-gap").map((item) => item.subject)).toEqual(expect.arrayContaining(["OS", "计组", "计网"]));
    expect(result.diagnoses.some((item) => ["操作系统", "组成原理", "计算机网络"].includes(item.subject ?? ""))).toBe(false);
    expect(result.tasks.some((item) => ["操作系统", "组成原理", "计算机网络"].includes(item.subject ?? ""))).toBe(false);
  });

  it("keeps completed intervention waiting distinct from proven improvement", () => {
    const staleRecord = record({ date: "2026-06-17", updatedAt: "2026-06-17T09:00:00.000Z" });
    const first = projection({ records: [staleRecord], evaluatedAt: "2026-06-21T08:00:00.000Z" });
    const issue = first.diagnoses.find((item) => item.issueKey === "subject-gap:数学")!;
    const completedTask: LearningCoachTask = {
      id: "task-1", createdAt: "2026-06-21T08:10:00.000Z", updatedAt: "2026-06-21T08:30:00.000Z", snapshotId: "snapshot-1", date: "2026-06-21",
      subject: "数学", kind: "practice", source: "rule", status: "completed", priority: 2, reasonCode: "subject-gap", title: "回顾极限", recordIds: ["record-1"], issueKey: issue.issueKey,
      action: { type: "ai-quiz", subject: "数学", recordIds: ["record-1"] }, completionPolicy: { type: "confirmed-quiz", targetRecordIds: ["record-1"] }, completedAt: "2026-06-21T08:29:00.000Z",
    };
    const quiz: LearningEvidence = {
      id: "quiz-confirmed", createdAt: "2026-06-21T08:28:00.000Z", updatedAt: "2026-06-21T08:28:00.000Z", date: "2026-06-21", occurredAt: "2026-06-21T08:28:00.000Z",
      kind: "quiz-assessment-confirmed", origin: "user-confirmed-ai", subject: "数学", source: { type: "ai-session", id: "quiz-session" }, target: { type: "record", id: "record-1" }, payload: { taskId: "task-1", outcome: "satisfactory" },
    };
    const outcome: LearningEvidence = {
      id: "task-outcome", createdAt: "2026-06-21T08:30:00.000Z", updatedAt: "2026-06-21T08:30:00.000Z", date: "2026-06-21", occurredAt: "2026-06-21T08:30:00.000Z",
      kind: "task-outcome", origin: "local", subject: "数学", source: { type: "coach-task", id: "task-1" }, payload: { taskId: "task-1", issueKey: issue.issueKey }, supportingEvidenceRefs: [{ type: "learning-evidence", id: "quiz-confirmed" }],
    };
    const after = projection({ records: [staleRecord], evidence: [quiz, outcome], tasks: [completedTask], previousDiagnoses: first.diagnoses, evaluatedAt: "2026-06-21T08:31:00.000Z" });
    expect(after.diagnoses.find((item) => item.issueKey === issue.issueKey)).toMatchObject({ status: "ongoing", interventionState: "awaiting-new-evidence" });
    expect(after.tasks.some((item) => item.issueKey === issue.issueKey)).toBe(false);
  });

  it("continues an overdue intervention when the remaining target set is different", () => {
    const records = [1, 2, 3].map((value) => record({ id: `r${value}`, date: "2026-06-17", updatedAt: "2026-06-17T09:00:00.000Z" }));
    const reviews = [1, 2, 3].map((value) => review({ id: `r${value}`, recordId: `r${value}`, updatedAt: "2026-06-17T09:00:00.000Z" }));
    const first = projection({ records, reviews, evaluatedAt: "2026-06-21T08:00:00.000Z" });
    const completedTask: LearningCoachTask = {
      id: "narrowed-review", createdAt: "2026-06-21T08:10:00.000Z", updatedAt: "2026-06-21T08:30:00.000Z", snapshotId: "snapshot-1", date: "2026-06-21",
      kind: "review", source: "rule", status: "completed", priority: 1, reasonCode: "review-overdue", title: "回顾 1 条逾期日志", recordIds: ["r1"], issueKey: "review-overdue",
      action: { type: "review-queue", recordIds: ["r1"] }, completionPolicy: { type: "review-logs", targetRecordIds: ["r1"] }, interventionKey: "review-overdue:review-queue:r1", completedAt: "2026-06-21T08:30:00.000Z",
    };
    const outcome: LearningEvidence = {
      id: "review-outcome", createdAt: "2026-06-21T08:30:00.000Z", updatedAt: "2026-06-21T08:30:00.000Z", date: "2026-06-21", occurredAt: "2026-06-21T08:30:00.000Z",
      kind: "task-outcome", origin: "local", source: { type: "coach-task", id: completedTask.id }, payload: { taskId: completedTask.id, issueKey: "review-overdue" }, supportingEvidenceRefs: [{ type: "review-log", id: "log-r1" }],
    };
    const after = projection({
      records,
      reviews: [review({ id: "r1", recordId: "r1", updatedAt: "2026-06-21T08:29:00.000Z", nextReviewDate: "2026-07-01" }), reviews[1], reviews[2]],
      evidence: [outcome], tasks: [completedTask], previousDiagnoses: first.diagnoses, evaluatedAt: "2026-06-21T08:31:00.000Z",
    });
    expect(after.diagnoses.find((item) => item.issueKey === "review-overdue")).toMatchObject({ status: "improved", interventionState: "actionable" });
    expect(after.tasks.find((item) => item.issueKey === "review-overdue")?.recordIds).toEqual(["r2", "r3"]);
  });

  it("resolves a subject gap only from a new meaningful fact and keeps its source", () => {
    const first = projection({ records: [record({ date: "2026-06-17", updatedAt: "2026-06-17T09:00:00.000Z" })], evaluatedAt: "2026-06-21T08:00:00.000Z" });
    const fresh = record({ id: "fresh-record", date: "2026-06-21", createdAt: "2026-06-21T09:00:00.000Z", updatedAt: "2026-06-21T09:00:00.000Z", title: "导数练习" });
    const after = projection({ records: [record({ date: "2026-06-17", updatedAt: "2026-06-17T09:00:00.000Z" }), fresh], previousDiagnoses: first.diagnoses, evaluatedAt: "2026-06-21T09:01:00.000Z" });
    expect(after.diagnoses.find((item) => item.issueKey === "subject-gap:数学")).toMatchObject({ status: "resolved", resolutionEvidenceRefs: [{ type: "record", id: "fresh-record" }] });
  });
});
