import { describe, expect, it } from "vitest";
import type { KnowledgePoint, KnowledgeRelation, LearningCoachDiagnosis, LearningCoachTask } from "../types";
import { buildLearningCoachDecision } from "./learningCoachDecisionService";

const stamp = "2026-08-30T08:00:00.000Z";
const point = (id: string, name: string): KnowledgePoint => ({ id, createdAt: stamp, updatedAt: stamp, subject: "计网", name, normalizedKey: id, aliases: [], status: "active" });
const diagnosis = (issueKey: string, knowledgePointId: string, code: LearningCoachDiagnosis["code"] = "kp-assessment-needs-review", patch: Partial<LearningCoachDiagnosis> = {}): LearningCoachDiagnosis => ({ issueKey, code, level: "knowledge-point", knowledgePointId, status: "ongoing", priority: 2, subject: "计网", recordIds: [], message: issueKey, firstDetectedAt: stamp, ...patch });
const task = (issueKey: string, knowledgePointId: string): LearningCoachTask => ({ id: `task-${knowledgePointId}`, createdAt: stamp, updatedAt: stamp, snapshotId: "snapshot", date: "2026-08-30", kind: "practice", source: "rule", status: "pending", priority: 2, reasonCode: "kp-assessment-needs-review", title: `处理 ${knowledgePointId}`, recordIds: [], issueKey, scope: "knowledge-point", knowledgePointId, action: { type: "create-record", subject: "计网", recordIds: [], knowledgePointId }, completionPolicy: { type: "meaningful-record-with-knowledge-point-link", knowledgePointId } });
const relation = (id: string, fromKnowledgePointId: string, toKnowledgePointId: string): KnowledgeRelation => ({ id, createdAt: stamp, updatedAt: stamp, fromKnowledgePointId, toKnowledgePointId, type: "prerequisite-of", status: "confirmed", sourceRefs: [{ type: "knowledge-point", id: fromKnowledgePointId }], origin: "user", confirmedAt: stamp });

describe("Phase 3 deterministic decision policy", () => {
  it("does not invent a common root without a confirmed relation", () => {
    const diagnoses = [diagnosis("a", "a"), diagnosis("b", "b")];
    const result = buildLearningCoachDecision({ diagnoses, tasks: [task("a", "a"), task("b", "b")], relations: [], knowledgePoints: [point("a", "A"), point("b", "B")], evaluatedAt: stamp });
    expect(result.status).toBe("recommended");
    expect(result.supportingRelationIds).toEqual([]);
    expect(result.supportingIssueKeys).toEqual(["a"]);
  });

  it("prioritizes a confirmed prerequisite that affects two active issues", () => {
    const points = [point("root", "MTU"), point("ipv4", "IPv4 分片"), point("path", "路径 MTU")];
    const diagnoses = [diagnosis("root-issue", "root", "kp-linked-review-overdue", { metric: { current: 1, threshold: 0, unit: "条", direction: "above" } }), diagnosis("ipv4-issue", "ipv4"), diagnosis("path-issue", "path")];
    const result = buildLearningCoachDecision({ diagnoses, tasks: diagnoses.map((item) => task(item.issueKey!, item.knowledgePointId!)), relations: [relation("rel-1", "root", "ipv4"), relation("rel-2", "root", "path")], knowledgePoints: points, evaluatedAt: stamp });
    expect(result.recommendedKnowledgePointId).toBe("root");
    expect(result.supportingIssueKeys).toEqual(["root-issue", "ipv4-issue", "path-issue"]);
    expect(result.supportingRelationIds).toEqual(["rel-1", "rel-2"]);
    expect(result.priorityRationale).toContain("MTU");
  });

  it("ignores retired relations and does not aggregate duplicate alerts", () => {
    const points = [point("root", "MTU"), point("child", "IPv4")];
    const diagnoses = [diagnosis("root-issue", "root"), diagnosis("child-issue", "child")];
    const retired = { ...relation("rel", "root", "child"), status: "retired" as const };
    const result = buildLearningCoachDecision({ diagnoses, tasks: diagnoses.map((item) => task(item.issueKey!, item.knowledgePointId!)), relations: [retired], knowledgePoints: points, evaluatedAt: stamp });
    expect(result.supportingRelationIds).toEqual([]);
    expect(result.supportingIssueKeys.length).toBe(1);
    expect(["root-issue", "child-issue"]).toContain(result.supportingIssueKeys[0]);
  });

  it("waits when all interventions await new evidence", () => {
    const diagnoses = [diagnosis("waiting", "a", "kp-assessment-needs-review", { interventionState: "awaiting-new-evidence" })];
    const result = buildLearningCoachDecision({ diagnoses, tasks: [task("waiting", "a")], relations: [], knowledgePoints: [point("a", "A")], evaluatedAt: stamp });
    expect(result.status).toBe("no-action");
    expect(result.priorityRationale).toContain("等待");
  });

  it("is stable across repeated runtime evaluations", () => {
    const first = buildLearningCoachDecision({ diagnoses: [diagnosis("a", "a", "kp-assessment-needs-review", { lastEvaluatedAt: stamp })], tasks: [task("a", "a")], relations: [], knowledgePoints: [point("a", "A")], evaluatedAt: stamp });
    const second = buildLearningCoachDecision({ diagnoses: [diagnosis("a", "a", "kp-assessment-needs-review", { lastEvaluatedAt: "2026-08-30T08:00:01.000Z" })], tasks: [task("a", "a")], relations: [], knowledgePoints: [point("a", "A")], evaluatedAt: "2026-08-30T08:00:01.000Z" });
    expect(second.decisionInputsFingerprint).toBe(first.decisionInputsFingerprint);
    expect(second.recommendedKnowledgePointId).toBe(first.recommendedKnowledgePointId);
    expect(second.recommendedTaskId).toBe(first.recommendedTaskId);
    expect(second.priorityRationale).toBe(first.priorityRationale);
  });

  it("changes fingerprint when a decision-relevant metric changes", () => {
    const first = buildLearningCoachDecision({ diagnoses: [diagnosis("a", "a", "kp-linked-review-overdue", { metric: { current: 1, threshold: 0, unit: "条", direction: "above" } })], tasks: [task("a", "a")], relations: [], knowledgePoints: [point("a", "A")], evaluatedAt: stamp });
    const second = buildLearningCoachDecision({ diagnoses: [diagnosis("a", "a", "kp-linked-review-overdue", { metric: { current: 2, threshold: 0, unit: "条", direction: "above" } })], tasks: [task("a", "a")], relations: [], knowledgePoints: [point("a", "A")], evaluatedAt: stamp });
    expect(second.decisionInputsFingerprint).not.toBe(first.decisionInputsFingerprint);
  });
});
