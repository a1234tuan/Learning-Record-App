import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdaptiveReviewPage } from "./AdaptiveReviewPage";
import { coachTestBlock, coachTestBlueprint, coachTestTask, coachTestTurn, completeCoachTestSnapshot } from "./reviewCoachTestFixtures";

const record = { id: "record-1", type: "record" as const, date: "2026-09-07", order: 0, subject: "数据结构", title: "BFS", contentHtml: `<record-decision-block data-decision-block-id="${coachTestBlock.id}" data-content-version="1"><p>Mark visited before enqueue.</p></record-decision-block>`, assets: [], formulas: [], mistakeRefs: [], tags: [], createdAt: "2026-09-07T08:00:00.000Z", updatedAt: "2026-09-07T08:00:00.000Z" };
const props = { taskId: coachTestTask.id, records: [record], onBack: vi.fn(), onGenerateTurn: vi.fn(), onRequestHint: vi.fn(), onSubmitAnswer: vi.fn(), onSkipTurn: vi.fn(), onReportInvalid: vi.fn(), onFinish: vi.fn(), onDefer: vi.fn(), onAbandon: vi.fn() };

describe("AdaptiveReviewPage", () => {
  it("hides answer criteria and source until the user submits", () => {
    const snapshot = completeCoachTestSnapshot();
    snapshot.adaptiveReviewTasks[0] = { ...coachTestTask, status: "in-progress" };
    snapshot.adaptiveQuizTurns[0] = { ...coachTestTurn, status: "displayed", answerText: undefined, answeredAt: undefined, assessment: undefined, assessmentRationale: undefined, availableHints: ["Think about duplicates."], hintsUsed: [] };
    render(<AdaptiveReviewPage {...props} snapshot={snapshot} />);
    expect(screen.queryByText("答案依据")).not.toBeInTheDocument();
    expect(screen.queryByText("Mark visited before enqueue.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提示 1" })).toBeInTheDocument();
  });

  it("shows answer evidence after submission and requires confirmation for conflicting mastery", () => {
    const snapshot = completeCoachTestSnapshot();
    snapshot.adaptiveReviewTasks[0] = { ...coachTestTask, status: "in-progress" };
    snapshot.adaptiveQuizTurns[0] = { ...coachTestTurn, assessment: "incorrect", assessmentRationale: "Wrong order", answerText: "After dequeue" };
    render(<AdaptiveReviewPage {...props} snapshot={snapshot} />);
    expect(screen.getByText("答案依据")).toBeInTheDocument();
    expect(screen.getByText("Mark visited before enqueue.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "结束本次训练" }));
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    expect(screen.getByRole("button", { name: "确认已掌握" })).toBeInTheDocument();
    expect(props.onFinish).not.toHaveBeenCalled();
  });
});
