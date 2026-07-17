import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordBlock, RecordReviewLog, RecordReviewRating, RecordReviewState, RecordReviewStats, RecordReviewUndoToken } from "../types";

vi.mock("../components/RichTextEditor", () => ({
  RichTextEditor: () => <div data-testid="rich-editor" />,
}));

vi.mock("../lib/date", async () => {
  const actual = await vi.importActual<typeof import("../lib/date")>("../lib/date");
  return {
    ...actual,
    todayISO: () => "2026-07-03",
  };
});

import { ReviewPage } from "./ReviewPage";

const stamp = "2026-06-21T00:00:00.000Z";

const record = (id: string, title: string, subject: string): RecordBlock => ({
  id,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-20",
  order: 0,
  subject,
  title,
  contentHtml: "<p>content</p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
});

const review = (recordId: string, patch: Partial<RecordReviewState> = {}): RecordReviewState => ({
  id: recordId,
  recordId,
  createdAt: stamp,
  updatedAt: stamp,
  status: "active",
  easeFactor: 2.5,
  repetition: 1,
  intervalDays: 1,
  nextReviewDate: "2026-07-02",
  consecutiveRemembered: 1,
  totalReviews: 2,
  ...patch,
});

const reviewLog = (recordId: string, patch: Partial<RecordReviewLog> = {}): RecordReviewLog => ({
  id: `log-${recordId}`,
  recordId,
  createdAt: stamp,
  updatedAt: stamp,
  rating: "good",
  normalizedRating: "good",
  reviewKind: "overview",
  scheduler: "overview-v1",
  reviewedAt: "2026-07-02T16:30:00.000Z",
  previousEaseFactor: 2.5,
  nextEaseFactor: 2.6,
  previousRepetition: 1,
  nextRepetition: 2,
  previousIntervalDays: 1,
  nextIntervalDays: 6,
  ...patch,
});

const undoToken = (recordId: string): RecordReviewUndoToken => ({
  recordId,
  reviewedAt: "2026-07-03T01:30:00.000Z",
  reviewLogId: `log-${recordId}`,
  previousReview: review(recordId),
});

const stats: RecordReviewStats = {
  activeCount: 2,
  masteredCount: 1,
  dueCount: 2,
  overdueCount: 1,
  totalReviews: 2,
  streakDays: 0,
  dayStats: [],
  masteryTrend: [],
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const records = [
  record("active", "BFS 队列", "数据结构"),
  record("second", "页表缓存", "OS"),
  record("new", "概率笔记", "数学"),
  record("mastered", "进程同步", "OS"),
];

type RenderOptions = Partial<React.ComponentProps<typeof ReviewPage>>;

const renderReviewPage = (options: RenderOptions = {}) => {
  const handlers = {
    onModeChange: vi.fn(),
    onQueueChange: vi.fn(),
    onCurrentRecordChange: vi.fn(),
    onEnsureDay: vi.fn().mockResolvedValue(undefined),
    onRate: vi.fn().mockResolvedValue(undefined),
    onUndo: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onOpenRecord: vi.fn(),
    onEditRecord: vi.fn(),
    onAddToReview: vi.fn(),
    onRemoveReview: vi.fn(),
    onResetReview: vi.fn(),
  };
  render(
    <ReviewPage
      records={records}
      dueReviews={[review("active")]}
      reviewStates={[review("active"), review("mastered", { status: "mastered", nextReviewDate: undefined })]}
      stats={stats}
      mode="manage"
      queueIds={["active"]}
      currentRecordId="active"
      {...handlers}
      {...options}
    />,
  );
  return { handlers: { ...handlers, ...options }, records };
};

const clickRating = (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
};

describe("ReviewPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("manages all record cards with deck, due date and review actions", () => {
    const { handlers } = renderReviewPage();

    expect(screen.getByText("BFS 队列")).toBeInTheDocument();
    expect(screen.getByText("概率笔记")).toBeInTheDocument();
    expect(screen.getByText("进程同步")).toBeInTheDocument();

    const activeCard = screen.getByText("BFS 队列").closest("article");
    expect(activeCard).not.toBeNull();
    expect(within(activeCard as HTMLElement).getByText("数据结构")).toBeInTheDocument();
    expect(within(activeCard as HTMLElement).getByText(/到期 2026-07-02/)).toBeInTheDocument();

    fireEvent.click(within(activeCard as HTMLElement).getByRole("button", { name: /预览/ }));
    fireEvent.click(within(activeCard as HTMLElement).getByRole("button", { name: /编辑/ }));
    fireEvent.click(within(activeCard as HTMLElement).getByRole("button", { name: /忘记重排/ }));
    fireEvent.click(within(activeCard as HTMLElement).getByRole("button", { name: /搁置/ }));

    expect(handlers.onOpenRecord).toHaveBeenCalledWith(records[0]);
    expect(handlers.onEditRecord).toHaveBeenCalledWith(records[0]);
    expect(handlers.onResetReview).toHaveBeenCalledWith("active");
    expect(handlers.onRemoveReview).toHaveBeenCalledWith("active");

    const newCard = screen.getByText("概率笔记").closest("article");
    expect(newCard).not.toBeNull();
    expect(within(newCard as HTMLElement).getByText("新卡")).toBeInTheDocument();
    fireEvent.click(within(newCard as HTMLElement).getByRole("button", { name: /加入复习/ }));

    expect(handlers.onAddToReview).toHaveBeenCalledWith("new");
  });

  it("does not clear an existing queue while the daily suggestion queue initializes", async () => {
    const onQueueChange = vi.fn();
    const onCurrentRecordChange = vi.fn();

    renderReviewPage({
      mode: "queue",
      dueReviews: [review("active")],
      reviewStates: [review("active")],
      queueIds: ["active"],
      currentRecordId: "active",
      onQueueChange,
      onCurrentRecordChange,
    });

    expect(screen.getByText("BFS 队列")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("BFS 队列")).toBeInTheDocument());
    expect(onQueueChange).not.toHaveBeenCalledWith([]);
    expect(onCurrentRecordChange).not.toHaveBeenCalledWith(undefined);
  });

  it("initializes the suggested queue with at most twenty due cards", async () => {
    const manyRecords = Array.from({ length: 25 }, (_, index) => record(`due-${index + 1}`, `复习卡 ${index + 1}`, "数据结构"));
    const manyReviews = manyRecords.map((item) => review(item.id));
    const onQueueChange = vi.fn();
    const onCurrentRecordChange = vi.fn();

    renderReviewPage({
      records: manyRecords,
      dueReviews: manyReviews,
      reviewStates: manyReviews,
      mode: "queue",
      queueIds: [],
      currentRecordId: undefined,
      onQueueChange,
      onCurrentRecordChange,
    });

    const expectedIds = manyRecords.slice(0, 20).map((item) => item.id);
    await waitFor(() => expect(onQueueChange).toHaveBeenCalledWith(expectedIds));
    expect(onCurrentRecordChange).toHaveBeenCalledWith("due-1");
  });

  it("filters card manager by deck and state", () => {
    renderReviewPage();

    fireEvent.change(screen.getByLabelText("所属牌组"), { target: { value: "数学" } });
    expect(screen.getByText("概率笔记")).toBeInTheDocument();
    expect(screen.queryByText("BFS 队列")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("卡片状态"), { target: { value: "mastered" } });
    expect(screen.getByText("没有匹配的卡片")).toBeInTheDocument();
  });

  it("removes an overdue card immediately after a good rating and prevents stale due props from requeueing it", async () => {
    const onRate = vi.fn().mockResolvedValue(undefined);
    const onQueueChange = vi.fn();
    const onCurrentRecordChange = vi.fn();
    const { rerender } = render(
      <ReviewPage
        records={records}
        dueReviews={[review("active")]}
        reviewStates={[review("active")]}
        stats={stats}
        mode="queue"
        queueIds={["active"]}
        currentRecordId="active"
        onModeChange={vi.fn()}
        onQueueChange={onQueueChange}
        onCurrentRecordChange={onCurrentRecordChange}
        onEnsureDay={vi.fn().mockResolvedValue(undefined)}
        onRate={onRate}
        onUndo={vi.fn().mockResolvedValue(undefined)}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenRecord={vi.fn()}
        onEditRecord={vi.fn()}
        onAddToReview={vi.fn()}
        onRemoveReview={vi.fn()}
        onResetReview={vi.fn()}
      />,
    );

    expect(screen.getByText("BFS 队列")).toBeInTheDocument();
    clickRating(/良好/);

    expect(onQueueChange).toHaveBeenLastCalledWith([]);
    expect(onCurrentRecordChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByText("BFS 队列")).not.toBeInTheDocument();

    rerender(
      <ReviewPage
        records={records}
        dueReviews={[review("active")]}
        reviewStates={[review("active")]}
        stats={stats}
        mode="queue"
        queueIds={["active"]}
        currentRecordId="active"
        onModeChange={vi.fn()}
        onQueueChange={onQueueChange}
        onCurrentRecordChange={onCurrentRecordChange}
        onEnsureDay={vi.fn().mockResolvedValue(undefined)}
        onRate={onRate}
        onUndo={vi.fn().mockResolvedValue(undefined)}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenRecord={vi.fn()}
        onEditRecord={vi.fn()}
        onAddToReview={vi.fn()}
        onRemoveReview={vi.fn()}
        onResetReview={vi.fn()}
      />,
    );

    expect(screen.queryByText("BFS 队列")).not.toBeInTheDocument();
    await waitFor(() => expect(onRate).toHaveBeenCalledWith("active", "good"));
  });

  it("submits the current evaluation draft with the rating and clears the saved draft", async () => {
    const onRate = vi.fn().mockResolvedValue(undefined);
    renderReviewPage({
      mode: "queue",
      dueReviews: [review("active")],
      reviewStates: [review("active")],
      queueIds: ["active"],
      currentRecordId: "active",
      onRate,
    });

    fireEvent.click(screen.getByRole("button", { name: /本次评价/ }));
    fireEvent.change(screen.getByLabelText("本次复习评价"), {
      target: { value: "- 新理解\n1. 掌握更稳" },
    });
    clickRating(/良好/);

    await waitFor(() => expect(onRate).toHaveBeenCalledWith("active", "good", "- 新理解\n1. 掌握更稳"));
    expect(window.localStorage.getItem("study-journal-review-evaluation-draft:active")).toBeNull();
  });

  it("keeps the evaluation draft when rating fails", async () => {
    const onRate = vi.fn().mockRejectedValue(new Error("数据库写入失败"));
    renderReviewPage({
      mode: "queue",
      dueReviews: [review("active")],
      reviewStates: [review("active")],
      queueIds: ["active"],
      currentRecordId: "active",
      onRate,
    });

    fireEvent.click(screen.getByRole("button", { name: /本次评价/ }));
    fireEvent.change(screen.getByLabelText("本次复习评价"), {
      target: { value: "这次还是容易混淆" },
    });
    clickRating(/良好/);

    await waitFor(() => expect(screen.getByText(/复习评分失败/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("本次复习评价")).toHaveValue("这次还是容易混淆"));
  });

  it("shows historical evaluation text in the review evaluation panel", () => {
    renderReviewPage({
      mode: "queue",
      dueReviews: [review("active")],
      reviewStates: [review("active")],
      reviewLogsByRecord: {
        active: [reviewLog("active", { evaluationText: "- 上次把页表和 TLB 关系理顺了" })],
      },
      queueIds: ["active"],
      currentRecordId: "active",
    });

    fireEvent.click(screen.getByRole("button", { name: /本次评价/ }));

    expect(screen.getByText("- 上次把页表和 TLB 关系理顺了")).toBeInTheDocument();
  });

  it("disables rating buttons while a rating is in flight and avoids duplicate rate calls", async () => {
    const pending = deferred<void>();
    const onRate = vi.fn(() => pending.promise);
    renderReviewPage({
      mode: "queue",
      dueReviews: [review("active"), review("second", { nextReviewDate: "2026-07-03" })],
      reviewStates: [review("active"), review("second", { nextReviewDate: "2026-07-03" })],
      queueIds: ["active", "second"],
      currentRecordId: "active",
      onRate: onRate as (recordId: string, rating: RecordReviewRating) => Promise<RecordReviewUndoToken | undefined>,
    });

    clickRating(/良好/);
    expect(screen.getByText("页表缓存")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /良好/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /模糊/ }));
    expect(onRate).toHaveBeenCalledTimes(1);

    pending.resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: "今日复习" })).toBeInTheDocument());
  });

  it("rolls the current card back into the queue when rating fails", async () => {
    const onRate = vi.fn().mockRejectedValue(new Error("数据库写入失败"));
    const onQueueChange = vi.fn();
    const onCurrentRecordChange = vi.fn();
    renderReviewPage({
      mode: "queue",
      dueReviews: [review("active")],
      reviewStates: [review("active")],
      queueIds: ["active"],
      currentRecordId: "active",
      onRate,
      onQueueChange,
      onCurrentRecordChange,
    });

    clickRating(/良好/);

    await waitFor(() => expect(screen.getByText("BFS 队列")).toBeInTheDocument());
    expect(screen.getByText(/复习评分失败/)).toBeInTheDocument();
    expect(onQueueChange).toHaveBeenLastCalledWith(["active"]);
    expect(onCurrentRecordChange).toHaveBeenLastCalledWith("active");
  });

  it("undoes consecutive ratings in reverse order and restores the evaluation draft", async () => {
    const onRate = vi.fn()
      .mockResolvedValueOnce(undoToken("active"))
      .mockResolvedValueOnce(undoToken("second"));
    const onUndo = vi.fn().mockResolvedValue(undefined);
    const onQueueChange = vi.fn();
    const onCurrentRecordChange = vi.fn();
    renderReviewPage({
      mode: "queue",
      dueReviews: [review("active"), review("second", { nextReviewDate: "2026-07-03" })],
      reviewStates: [review("active"), review("second", { nextReviewDate: "2026-07-03" })],
      queueIds: ["active", "second"],
      currentRecordId: "active",
      onRate,
      onUndo,
      onQueueChange,
      onCurrentRecordChange,
    });

    fireEvent.click(screen.getByRole("button", { name: /本次评价/ }));
    fireEvent.change(screen.getByLabelText("本次复习评价"), { target: { value: "要重新理解 BFS 层序边界" } });
    clickRating(/良好/);
    await waitFor(() => expect(screen.getByRole("button", { name: "撤回" })).toBeEnabled());
    await waitFor(() => expect(screen.getByText("页表缓存")).toBeInTheDocument());

    clickRating(/良好/);
    await waitFor(() => expect(screen.getByText("今天暂无待复习")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ recordId: "second" })));
    await waitFor(() => expect(screen.getByText("页表缓存")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "撤回" }));
    await waitFor(() => expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ recordId: "active" })));
    await waitFor(() => expect(screen.getByText("BFS 队列")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("本次复习评价")).toHaveValue("要重新理解 BFS 层序边界"));
    expect(onQueueChange).toHaveBeenLastCalledWith(["active", "second"]);
    expect(onCurrentRecordChange).toHaveBeenLastCalledWith("active");
  });

  it("keeps an undone card in the active queue after refreshed due reviews arrive", async () => {
    const initialDueReviews = [review("active"), review("second", { nextReviewDate: "2026-07-03" })];
    const undoRefresh = deferred<void>();

    const ReviewQueueHarness = () => {
      const [dueReviews, setDueReviews] = useState(initialDueReviews);
      const [queueIds, setQueueIds] = useState(["active", "second"]);
      const [currentRecordId, setCurrentRecordId] = useState<string | undefined>("active");

      return (
        <>
          <output data-testid="review-queue">{queueIds.join("|")}</output>
          <ReviewPage
            records={records}
            dueReviews={dueReviews}
            reviewStates={initialDueReviews}
            stats={stats}
            mode="queue"
            queueIds={queueIds}
            currentRecordId={currentRecordId}
            onModeChange={vi.fn()}
            onQueueChange={setQueueIds}
            onCurrentRecordChange={setCurrentRecordId}
            onEnsureDay={vi.fn().mockResolvedValue(undefined)}
            onRate={async (recordId) => {
              setDueReviews((current) => current.filter((review) => review.recordId !== recordId));
              return undoToken(recordId);
            }}
            onUndo={async () => {
              setDueReviews(initialDueReviews);
              await undoRefresh.promise;
            }}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onOpenRecord={vi.fn()}
            onEditRecord={vi.fn()}
            onAddToReview={vi.fn()}
            onRemoveReview={vi.fn()}
            onResetReview={vi.fn()}
          />
        </>
      );
    };

    render(<ReviewQueueHarness />);

    clickRating(/良好/);
    await waitFor(() => expect(screen.getByText("页表缓存")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "撤回" }));
    await waitFor(() => expect(screen.getByTestId("review-queue")).toHaveTextContent("second"));

    undoRefresh.resolve(undefined);

    await waitFor(() => expect(screen.getByText("BFS 队列")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("review-queue")).toHaveTextContent("active|second"));
  });

  it("advances through due cards and shows empty state after the last card", async () => {
    const onQueueChange = vi.fn();
    const onCurrentRecordChange = vi.fn();
    renderReviewPage({
      mode: "queue",
      dueReviews: [review("active"), review("second", { nextReviewDate: "2026-07-03" })],
      reviewStates: [review("active"), review("second", { nextReviewDate: "2026-07-03" })],
      queueIds: ["active", "second"],
      currentRecordId: "active",
      onQueueChange,
      onCurrentRecordChange,
    });

    clickRating(/良好/);

    expect(onQueueChange).toHaveBeenLastCalledWith(["second"]);
    expect(onCurrentRecordChange).toHaveBeenLastCalledWith("second");
    await waitFor(() => expect(screen.getByText("页表缓存")).toBeInTheDocument());
  });
});
