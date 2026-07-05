import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RecordBlock, RecordReviewRating, RecordReviewState, RecordReviewStats } from "../types";

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

  it("disables rating buttons while a rating is in flight and avoids duplicate rate calls", async () => {
    const pending = deferred<void>();
    const onRate = vi.fn(() => pending.promise);
    renderReviewPage({
      mode: "queue",
      dueReviews: [review("active"), review("second", { nextReviewDate: "2026-07-03" })],
      reviewStates: [review("active"), review("second", { nextReviewDate: "2026-07-03" })],
      queueIds: ["active", "second"],
      currentRecordId: "active",
      onRate: onRate as (recordId: string, rating: RecordReviewRating) => Promise<void>,
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
