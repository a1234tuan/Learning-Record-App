import { describe, expect, it } from "vitest";

import type { KnowledgePoint, LearningCoachDiagnosis, LearningEvidence, RecordBlock, RecordKnowledgePointLink, RecordReviewState } from "../types";
import { buildKnowledgePointProjection, knowledgePointIssueKey } from "./knowledgePointService";
import { recordKnowledgeFingerprint } from "../lib/knowledgePointIdentity";

const stamp = "2026-08-29T08:00:00.000Z";
const record = (id: string, updatedAt = stamp): RecordBlock => ({
  id, createdAt: updatedAt, updatedAt, type: "record", date: updatedAt.slice(0, 10), order: 0, subject: "计网", title: "IPv4 子网划分", contentHtml: "<p>子网掩码用于划分网络位和主机位。</p>", assets: [], formulas: [], mistakeRefs: [], tags: [],
});
const point: KnowledgePoint = { id: "kp-ipv4", createdAt: stamp, updatedAt: stamp, subject: "计网", name: "IPv4 子网划分", normalizedKey: "ipv4 子网划分", aliases: [], status: "active" };
const link = (recordId: string, confirmedAt = stamp): RecordKnowledgePointLink => ({ id: `link-${recordId}`, createdAt: confirmedAt, updatedAt: confirmedAt, recordId, knowledgePointId: point.id, role: "primary", recordFingerprint: recordKnowledgeFingerprint(record(recordId, confirmedAt)), confirmationSource: "manual", confirmedAt, status: "active" });
const review = (recordId: string, nextReviewDate: string): RecordReviewState => ({ id: `review-${recordId}`, createdAt: stamp, updatedAt: stamp, recordId, status: "active", easeFactor: 2.5, repetition: 1, intervalDays: 1, nextReviewDate, consecutiveRemembered: 0, totalReviews: 0 });
const assessment = (id: string, outcome: "needs-review" | "satisfactory", occurredAt: string): LearningEvidence => ({ id, createdAt: occurredAt, updatedAt: occurredAt, date: occurredAt.slice(0, 10), occurredAt, subject: "计网", kind: "quiz-assessment-confirmed", origin: "user-confirmed-ai", source: { type: "ai-session", id: `session-${id}` }, target: { type: "knowledge-point", id: point.id }, payload: { outcome } });

const project = (patch: Partial<Parameters<typeof buildKnowledgePointProjection>[0]> = {}) => buildKnowledgePointProjection({
  today: "2026-08-29", points: [point], links: [link("record-1")], records: [record("record-1")], reviews: [], reviewLogs: [], evidence: [], tasks: [], recordDiagnoses: [], evaluatedAt: stamp, ...patch,
});

describe("KnowledgePoint deterministic projection", () => {
  it("ignores a point without a formal active Record link", () => {
    const result = project({ links: [] });
    expect(result.states).toEqual([]);
    expect(result.diagnoses).toEqual([]);
  });

  it("refines a Record overdue diagnosis and reuses its intervention instead of creating a parallel task", () => {
    const parent: LearningCoachDiagnosis = { issueKey: "review-overdue", code: "review-overdue", status: "ongoing", priority: 1, recordIds: ["record-1"], message: "逾期" };
    const result = project({ reviews: [review("record-1", "2026-08-20")], recordDiagnoses: [parent] });
    expect(result.diagnoses[0]).toMatchObject({ code: "kp-linked-review-overdue", parentIssueKey: parent.issueKey, level: "knowledge-point" });
    expect(result.tasks).toEqual([]);
  });

  it("recommends a corrective Record after an insufficient confirmed validation", () => {
    const weak = assessment("weak", "needs-review", "2026-08-29T09:00:00.000Z");
    const result = project({ evidence: [weak] });
    expect(result.diagnoses[0]).toMatchObject({ code: "kp-assessment-needs-review", message: expect.stringContaining("需要再次验证") });
    expect(result.tasks[0]).toMatchObject({
      action: { type: "create-record", knowledgePointId: point.id },
      completionPolicy: { type: "meaningful-record-with-knowledge-point-link", knowledgePointId: point.id },
    });
  });

  it("moves to a verification Quiz only after a later formal corrective Record link", () => {
    const weak = assessment("weak", "needs-review", "2026-08-29T09:00:00.000Z");
    const correctionTime = "2026-08-29T10:00:00.000Z";
    const result = project({
      records: [record("record-1"), record("record-2", correctionTime)],
      links: [link("record-1"), link("record-2", correctionTime)],
      evidence: [weak],
    });
    expect(result.tasks[0]).toMatchObject({ action: { type: "ai-quiz", recordIds: ["record-2"], knowledgePointId: point.id } });
  });

  it("resolves the narrow assessment rule only after a later satisfactory confirmed validation", () => {
    const issueKey = knowledgePointIssueKey(point.id, "kp-assessment-needs-review");
    const prior: LearningCoachDiagnosis = { issueKey, code: "kp-assessment-needs-review", status: "ongoing", priority: 2, subject: "计网", knowledgePointId: point.id, level: "knowledge-point", recordIds: ["record-1"], message: "待验证", firstDetectedAt: "2026-08-28T08:00:00.000Z" };
    const result = project({ evidence: [assessment("ok", "satisfactory", stamp)], previousDiagnoses: [prior] });
    expect(result.diagnoses).toContainEqual(expect.objectContaining({ issueKey, status: "resolved", interventionState: "satisfied" }));
    expect(result.diagnoses[0].message).not.toContain("掌握");
  });

  it("selects satisfactory quiz evidence instead of a later corrective task outcome", () => {
    const issueKey = knowledgePointIssueKey(point.id, "kp-assessment-needs-review");
    const prior: LearningCoachDiagnosis = { issueKey, code: "kp-assessment-needs-review", status: "ongoing", priority: 2, subject: "计网", knowledgePointId: point.id, level: "knowledge-point", recordIds: ["record-1"], message: "待验证", firstDetectedAt: "2026-08-28T08:00:00.000Z" };
    const correctiveOutcome: LearningEvidence = {
      id: "corrective-outcome",
      createdAt: "2026-08-29T11:00:00.000Z",
      updatedAt: "2026-08-29T11:00:00.000Z",
      date: "2026-08-29",
      occurredAt: "2026-08-29T11:00:00.000Z",
      subject: "计网",
      kind: "task-outcome",
      origin: "local",
      source: { type: "coach-task", id: "corrective-task" },
      target: { type: "knowledge-point", id: point.id },
      payload: { taskId: "corrective-task", issueKey, actionType: "create-record" },
    };
    const satisfactory = assessment("satisfactory", "satisfactory", "2026-08-29T12:00:00.000Z");
    const result = project({ evidence: [correctiveOutcome, satisfactory], previousDiagnoses: [prior] });
    expect(result.diagnoses).toContainEqual(expect.objectContaining({
      issueKey,
      status: "resolved",
      resolutionEvidenceRefs: [{ type: "learning-evidence", id: "satisfactory" }],
    }));
    expect(result.diagnoses[0].status).toBe("resolved");
    expect(result.tasks).toEqual([]);
  });
});
