import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodayPage } from "./TodayPage";
import type { LearningCoachSnapshot, SubjectConfig } from "../types";
import { getDailyMotto } from "../lib/dailyMotto";

const stamp = "2026-06-21T00:00:00.000Z";

const subjects: SubjectConfig[] = [
  {
    id: "subject-math",
    createdAt: stamp,
    updatedAt: stamp,
    name: "数学",
    order: 0,
  },
];

const renderPage = (onOpenFavorites = vi.fn()) => render(
  <TodayPage
    entry={null}
    blocks={[]}
    examDate="2026-12-27"
    subjects={subjects}
    onSaveEntry={vi.fn()}
    onCreateRecord={vi.fn()}
    onOpenFavorites={onOpenFavorites}
    onOpenRecord={vi.fn()}
    onToggleFavorite={vi.fn()}
  />,
);

afterEach(() => {
  vi.useRealTimers();
});

describe("TodayPage", () => {
  it("keeps subject creation out of the home new-record panel", () => {
    renderPage();

    expect(screen.queryByLabelText("新增学科")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新建 .* 记录/ })).toBeInTheDocument();
    expect(screen.queryByText(/更多学科可到/)).not.toBeInTheDocument();
  });

  it("shows a stable daily motto in the page header", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T09:00:00+08:00"));
    renderPage();

    expect(screen.getByText(getDailyMotto("2026-07-04"))).toBeInTheDocument();
  });

  it("opens favorites from the compact header action", () => {
    const onOpenFavorites = vi.fn();
    renderPage(onOpenFavorites);

    fireEvent.click(screen.getByRole("button", { name: "打开收藏夹" }));

    expect(onOpenFavorites).toHaveBeenCalledTimes(1);
  });

  it("copies the selected template into a newly created record", async () => {
    const template = {
      id: "template-translation",
      createdAt: stamp,
      updatedAt: stamp,
      title: "翻译复盘",
      contentHtml: "<blockquote>原句</blockquote><ul><li>我的翻译</li></ul>",
    };
    const onCreateRecord = vi.fn().mockResolvedValue({ id: "record-1" });
    render(
      <TodayPage
        entry={null}
        blocks={[]}
        examDate="2026-12-27"
        subjects={subjects}
        templates={[template]}
        onSaveEntry={vi.fn()}
        onCreateRecord={onCreateRecord}
        onOpenFavorites={vi.fn()}
        onOpenRecord={vi.fn()}
        onToggleFavorite={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("新记录模板"), { target: { value: template.id } });
    fireEvent.click(screen.getByRole("button", { name: /新建 .* 记录/ }));

    await waitFor(() => expect(onCreateRecord).toHaveBeenCalledWith(
      expect.any(String),
      "数学",
      template.contentHtml,
    ));
  });

  it("keeps the learning cockpit as a compact entry after the primary record flow", async () => {
    const coachSnapshot: LearningCoachSnapshot = {
      id: "snapshot", createdAt: stamp, updatedAt: stamp, date: "2026-06-21", scenario: "general", inputFingerprint: "fingerprint",
      localSummary: { dueReviews: 0, overdueReviews: 0, pendingTasks: 0, studyMinutesLast7Days: 0, recordCountLast7Days: 0 }, diagnoses: [], taskIds: [],
    };
    const { container } = render(
      <TodayPage
        entry={null}
        blocks={[]}
        examDate="2026-12-27"
        subjects={subjects}
        onSaveEntry={vi.fn()}
        onCreateRecord={vi.fn()}
        onOpenFavorites={vi.fn()}
        onOpenRecord={vi.fn()}
        onToggleFavorite={vi.fn()}
        learningCoachSettings={{ id: "learning-coach", scenario: "general", dashboardEnabled: true, updatedAt: stamp }}
        learningCoachSnapshot={coachSnapshot}
        onEnsureLearningCoach={vi.fn().mockResolvedValue(coachSnapshot)}
      />,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "暂时没有需要关注的问题" })).toBeInTheDocument());
    const cockpit = container.querySelector(".learning-coach-entry")!;
    const newRecord = container.querySelector(".today-workbench")!;
    expect(newRecord.compareDocumentPosition(cockpit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看驾驶舱" })).toBeInTheDocument();
    expect(screen.queryByText("当前最重要的学习问题")).not.toBeInTheDocument();
  });
});
