import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgePointCoachSnapshot, LearningCoachSnapshot, LearningCoachTask, LearningEvidence, RecordBlock } from "../types";
import { LearningCoachDashboard } from "./LearningCoachDashboard";

const stamp = "2026-08-29T08:00:00.000Z";
const record: RecordBlock = {
  id: "record-ipv4", createdAt: stamp, updatedAt: stamp, type: "record", date: "2026-08-20", order: 0,
  subject: "计网", title: "IPv4 分片", contentHtml: "<p>IPv4 分片条件</p>", assets: [], formulas: [], mistakeRefs: [], tags: [],
};
const task = (patch: Partial<LearningCoachTask> = {}): LearningCoachTask => ({
  id: "task-quiz", createdAt: stamp, updatedAt: stamp, snapshotId: "snapshot", date: "2026-08-29", subject: "计网",
  kind: "practice", source: "rule", status: "pending", priority: 2, reasonCode: "subject-gap", title: "回顾《IPv4 分片》",
  actionLabel: "开始测验", reason: "连续 3 天没有学习记录。", recordIds: [record.id], issueKey: "subject-gap:计网",
  action: { type: "ai-quiz", subject: "计网", recordIds: [record.id] }, completionPolicy: { type: "confirmed-quiz", targetRecordIds: [record.id] },
  ...patch,
});
const snapshot = (patch: Partial<LearningCoachSnapshot> = {}): LearningCoachSnapshot => ({
  id: "snapshot", createdAt: stamp, updatedAt: stamp, date: "2026-08-29", scenario: "general", inputFingerprint: "fingerprint",
  localSummary: { dueReviews: 0, overdueReviews: 0, pendingTasks: 1, studyMinutesLast7Days: 0, recordCountLast7Days: 0 }, taskIds: ["task-quiz"],
  diagnoses: [{
    code: "subject-gap", issueKey: "subject-gap:计网", status: "new", priority: 2, subject: "计网", recordIds: [record.id],
    message: "计算机网络已连续 3 天没有学习记录。", reason: "最近连续 3 个完整自然日没有学习记录。",
    metric: { current: 9, threshold: 3, unit: "天", direction: "above" }, evidenceRefs: [{ type: "record", id: record.id }], interventionState: "actionable",
  }],
  ...patch,
});

const baseProps = {
  onRefresh: vi.fn(),
  onSkip: vi.fn(),
  records: [record],
};

describe("LearningCoachDashboard", () => {
  it("keeps the homepage summary as a lightweight cockpit entry", () => {
    const onOpenDetail = vi.fn();
    render(<LearningCoachDashboard
      variant="summary"
      snapshot={snapshot()}
      tasks={[task()]}
      onRefresh={vi.fn()}
      onSkip={vi.fn()}
      onOpenDetail={onOpenDetail}
    />);

    expect(screen.getByText("发现 1 个值得关注的问题")).toBeInTheDocument();
    expect(screen.getByText("当前有 1 个优先行动。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看驾驶舱" })).toBeInTheDocument();
    expect(screen.queryByText("当前最重要的学习问题")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始测验" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看驾驶舱" }));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("shows one decision first and keeps audit details collapsed", () => {
    const { container } = render(<LearningCoachDashboard
      snapshot={snapshot()}
      tasks={[task()]}
      onRefresh={vi.fn()}
      onSkip={vi.fn()}
      aiAvailability="available"
    />);

    expect(screen.getAllByRole("region", { name: "当前优先建议" })).toHaveLength(1);
    expect((container.querySelector(".coach-diagnosis-disclosure") as HTMLDetailsElement).open).toBe(false);
    expect((container.querySelector(".coach-ai-disclosure") as HTMLDetailsElement).open).toBe(false);
    expect(screen.queryByText("行动产生的真实结果")).not.toBeInTheDocument();
  });

  it("shows an awaiting intervention separately from proven improvement and translates quiz evidence", () => {
    const quizEvidence: LearningEvidence = {
      id: "quiz-result", createdAt: stamp, updatedAt: stamp, date: "2026-08-29", occurredAt: stamp, subject: "计网",
      kind: "quiz-assessment-confirmed", origin: "user-confirmed-ai", source: { type: "ai-session", id: "session" }, target: { type: "record", id: record.id }, payload: { outcome: "satisfactory" },
    };
    const outcome: LearningEvidence = {
      id: "task-result", createdAt: stamp, updatedAt: stamp, date: "2026-08-29", occurredAt: stamp, subject: "计网",
      kind: "task-outcome", origin: "local", source: { type: "coach-task", id: "task-quiz" }, payload: { issueKey: "subject-gap:计网" },
      supportingEvidenceRefs: [{ type: "learning-evidence", id: quizEvidence.id }],
    };
    render(<LearningCoachDashboard
      {...baseProps}
      snapshot={snapshot({ diagnoses: [{ ...snapshot().diagnoses[0], status: "ongoing", interventionState: "awaiting-new-evidence", latestIntervention: { taskId: "task-quiz", outcomeEvidenceId: outcome.id, outcome: "completed", occurredAt: stamp } }] })}
      tasks={[task({ status: "completed", completedAt: stamp })]}
      evidence={[quizEvidence, outcome]}
    />);

    expect(screen.getByText("等待新证据")).toBeInTheDocument();
    expect(screen.queryByText("有所改善")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("查看当前问题的原因与结果"));
    fireEvent.click(screen.getByRole("button", { name: /查看详情/ }));
    fireEvent.click(screen.getByRole("button", { name: "查看依据与历史" }));
    expect(screen.getByText(/单题测验反馈已确认：本次回答达到预期/)).toBeInTheDocument();
    expect(screen.queryByText(/quiz-assessment-confirmed|task-outcome/)).not.toBeInTheDocument();
  });

  it("shows the confirmed quiz as the resolution result even when an earlier intervention is retained", () => {
    const quizEvidence: LearningEvidence = {
      id: "resolved-quiz", createdAt: stamp, updatedAt: stamp, date: "2026-08-29", occurredAt: stamp, subject: "计网",
      kind: "quiz-assessment-confirmed", origin: "user-confirmed-ai", source: { type: "ai-session", id: "session-resolved" }, target: { type: "knowledge-point", id: "ipv4" }, payload: { outcome: "satisfactory" },
    };
    const earlierOutcome: LearningEvidence = {
      id: "earlier-correction", createdAt: stamp, updatedAt: stamp, date: "2026-08-29", occurredAt: stamp,
      subject: "计网", kind: "task-outcome", origin: "local", source: { type: "coach-task", id: "task-quiz" },
      payload: { issueKey: "subject-gap:计网" }, supportingEvidenceRefs: [{ type: "record", id: record.id }],
    };
    const resolved = {
      ...snapshot().diagnoses[0],
      status: "resolved" as const,
      interventionState: "satisfied" as const,
      latestIntervention: { taskId: "task-quiz", outcomeEvidenceId: earlierOutcome.id, outcome: "completed" as const, occurredAt: stamp },
      resolutionEvidenceRefs: [{ type: "learning-evidence" as const, id: quizEvidence.id }],
    };
    render(<LearningCoachDashboard
      {...baseProps}
      snapshot={snapshot({ diagnoses: [resolved] })}
      tasks={[task({ status: "completed", completedAt: stamp })]}
      evidence={[quizEvidence, earlierOutcome]}
    />);

    expect(screen.getByText(/单题测验反馈已确认：本次回答达到预期/)).toBeInTheDocument();
    expect(screen.getByText(/行动后的新判断/)).toBeInTheDocument();
  });

  it("does not expose a dead start-quiz action when remote AI is unavailable", () => {
    const onStartTask = vi.fn();
    const onOpenTaskRecord = vi.fn();
    render(<LearningCoachDashboard
      {...baseProps}
      snapshot={snapshot()}
      tasks={[task()]}
      aiAvailability="unavailable"
      onStartTask={onStartTask}
      onOpenTaskRecord={onOpenTaskRecord}
    />);

    fireEvent.click(screen.getByText("查看当前问题的原因与结果"));
    fireEvent.click(screen.getByRole("button", { name: /查看详情/ }));
    expect(screen.getByText(/不能启动或伪造完成这次测验/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跳过并调整" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开关联记录自行回顾" }));
    expect(onOpenTaskRecord).toHaveBeenCalledWith(expect.objectContaining({ id: "task-quiz" }));
    expect(onStartTask).not.toHaveBeenCalled();
  });

  it("explains why a skipped action is absent and when it will be reconsidered", () => {
    render(<LearningCoachDashboard
      {...baseProps}
      snapshot={snapshot({ diagnoses: [{ ...snapshot().diagnoses[0], status: "ongoing" }] })}
      tasks={[task({ status: "skipped", skipReason: "not-relevant", skippedAt: stamp, deferredUntil: "2026-09-05" })]}
    />);

    fireEvent.click(screen.getByText("查看当前问题的原因与结果"));
    fireEvent.click(screen.getByRole("button", { name: /查看详情/ }));
    expect(screen.getByText(/跳过原因：当前与你的学习重点不相关/)).toBeInTheDocument();
    expect(screen.getByText(/暂停到 2026-09-05/)).toBeInTheDocument();
    expect(screen.getByText(/当前因此暂时没有行动/)).toBeInTheDocument();
    expect(screen.getByText(/将在 2026-09-05 重新评估/)).toBeInTheDocument();
  });

  it("shows a KnowledgePoint refinement instead of duplicating its parent Record problem", () => {
    const pointSnapshot: KnowledgePointCoachSnapshot = {
      id: "kp-snapshot", createdAt: stamp, updatedAt: stamp, date: "2026-08-29", evaluatedAt: stamp, inputFingerprint: "kp-fp", states: [], taskIds: [],
      diagnoses: [{ issueKey: "kp:ipv4:kp-assessment-needs-review", parentIssueKey: "subject-gap:计网", code: "kp-assessment-needs-review", level: "knowledge-point", knowledgePointId: "ipv4", status: "ongoing", priority: 2, subject: "计网", recordIds: [record.id], message: "“IPv4 分片”最近一次确认验证需要再次验证。", reason: "最近一次确认验证不足；这不表示不会该知识点。", interventionState: "actionable" }],
    };
    render(<LearningCoachDashboard {...baseProps} snapshot={snapshot()} knowledgePointSnapshot={pointSnapshot} knowledgePoints={[{ id: "ipv4", createdAt: stamp, updatedAt: stamp, subject: "计网", name: "IPv4 分片", normalizedKey: "ipv4 分片", aliases: [], status: "active" }]} tasks={[task()]} aiAvailability="available" />);
    const diagnosisDisclosure = screen.getByText("查看当前问题的原因与结果").closest("details");
    expect(diagnosisDisclosure).not.toBeNull();
    expect((diagnosisDisclosure as HTMLDetailsElement).open).toBe(false);
    expect(screen.getAllByText(/“IPv4 分片”最近一次确认验证需要再次验证/)).toHaveLength(2);
    expect(screen.queryByText("计算机网络已连续 3 天没有学习记录。")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "开始测验" })).toHaveLength(1);
    fireEvent.click(screen.getByText("查看当前问题的原因与结果"));
    expect(screen.getByText(/知识点级问题/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看详情/ }));
  });
});
