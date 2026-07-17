import {
  ChevronDown,
  CheckCircle2,
  Edit3,
  Eye,
  MessageSquare,
  PauseCircle,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Undo2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RecordBlock, RecordReviewKind, RecordReviewLog, RecordReviewRating, RecordReviewState, RecordReviewStats, RecordReviewUndoToken } from "../types";
import { RichTextEditor } from "../components/RichTextEditor";
import { PageHeader, SurfaceCard } from "../components/ui";
import { normalizeRecordContent } from "../lib/recordContent";
import { isoDateTimeToLocalDate, todayISO } from "../lib/date";
import {
  ACTIVE_REVIEW_RATINGS,
  REVIEW_DAILY_SUGGESTED_LIMIT,
  isReviewDueOn,
  previewReviewRatings,
  ratingLabel,
  reviewKindLabel,
} from "../lib/reviewScheduler";
import type { ReviewMode } from "../lib/tabNavigation";

interface ReviewPageProps {
  records: RecordBlock[];
  dueReviews: RecordReviewState[];
  reviewStates: RecordReviewState[];
  reviewLogsByRecord?: Record<string, RecordReviewLog[]>;
  stats: RecordReviewStats | null;
  mode: ReviewMode;
  queueIds: string[];
  currentRecordId?: string;
  onModeChange: (mode: ReviewMode) => void;
  onQueueChange: (ids: string[]) => void;
  onCurrentRecordChange: (id?: string) => void;
  onEnsureDay: (date: string, dueCountAtFirstOpen: number) => Promise<unknown>;
  onRate: (recordId: string, rating: RecordReviewRating, evaluationText?: string) => Promise<RecordReviewUndoToken | undefined>;
  onUndo: (token: RecordReviewUndoToken) => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenRecord: (record: RecordBlock) => void;
  onEditRecord: (record: RecordBlock) => void;
  onAddToReview: (recordId: string) => Promise<void> | void;
  onRemoveReview: (recordId: string) => Promise<void> | void;
  onResetReview: (recordId: string) => Promise<void> | void;
}

type ReviewCardFilter = "all" | "due" | "new" | "active" | "suspended" | "mastered";
type ReviewKindFilter = "all" | RecordReviewKind;

interface ReviewUndoEntry {
  token: RecordReviewUndoToken;
  queueIds: string[];
  currentRecordId: string;
  evaluationText: string;
  dailyLimitIds: string[];
  showAllDue: boolean;
}

const ratingConfig: Array<{ rating: RecordReviewRating; label: string; icon: typeof CheckCircle2; className: string }> = [
  { rating: "forgot", label: "忘记了", icon: XCircle, className: "forgot" },
  { rating: "fuzzy", label: "模糊", icon: Sparkles, className: "fuzzy" },
  { rating: "good", label: "良好", icon: CheckCircle2, className: "good" },
  { rating: "easy", label: "轻松", icon: Star, className: "easy" },
];

const isDueReview = (review: RecordReviewState | undefined, today: string) => isReviewDueOn(review, today);

const reviewStatusLabel = (review: RecordReviewState | undefined, today: string) => {
  if (!review) return "新卡";
  if (review.status === "removed") return "已搁置";
  if (review.status === "mastered") return "已掌握";
  if (isDueReview(review, today)) return review.nextReviewDate && review.nextReviewDate < today ? "已过期" : "今日到期";
  return "复习中";
};

const reviewDueLabel = (review: RecordReviewState | undefined) => {
  if (!review || review.status === "removed") return "新卡";
  if (review.status === "mastered") return "无到期日";
  return review.nextReviewDate ? `到期 ${review.nextReviewDate}` : "待排期";
};

const intervalLabel = (days: number) => days <= 1 ? "明天" : `${days}天后`;

const sameIds = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const EMPTY_REVIEW_LOGS: RecordReviewLog[] = [];
const REVIEW_EVALUATION_DRAFT_PREFIX = "study-journal-review-evaluation-draft:";

const hasEvaluationText = (log: RecordReviewLog) => Boolean(log.evaluationText?.trim());

const reviewEvaluationDraftKey = (recordId: string) => `${REVIEW_EVALUATION_DRAFT_PREFIX}${recordId}`;

const readReviewEvaluationDraft = (recordId: string): string => {
  try {
    return window.localStorage.getItem(reviewEvaluationDraftKey(recordId)) ?? "";
  } catch {
    return "";
  }
};

const writeReviewEvaluationDraft = (recordId: string, text: string) => {
  try {
    const key = reviewEvaluationDraftKey(recordId);
    if (text.trim()) {
      window.localStorage.setItem(key, text);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable in private contexts; the in-memory draft still works for this session.
  }
};

const removeReviewEvaluationDraft = (recordId: string) => {
  try {
    window.localStorage.removeItem(reviewEvaluationDraftKey(recordId));
  } catch {
    // Ignore unavailable storage.
  }
};

const suggestedDailyLimitIds = (reviews: RecordReviewState[], today: string) =>
  reviews
    .filter((review) => isReviewDueOn(review, today))
    .slice(0, REVIEW_DAILY_SUGGESTED_LIMIT)
    .map((review) => review.recordId);

const matchesFilter = (review: RecordReviewState | undefined, filter: ReviewCardFilter, today: string) => {
  switch (filter) {
    case "all":
      return true;
    case "due":
      return isDueReview(review, today);
    case "new":
      return !review || review.status === "removed";
    case "active":
      return review?.status === "active";
    case "suspended":
      return review?.status === "removed";
    case "mastered":
      return review?.status === "mastered";
  }
};

const reviewSortScore = (review: RecordReviewState | undefined, today: string) => {
  if (isDueReview(review, today)) return 0;
  if (!review || review.status === "removed") return 1;
  if (review.status === "active") return 2;
  return 3;
};

export const ReviewPage = ({
  records,
  dueReviews,
  reviewStates,
  reviewLogsByRecord = {},
  stats,
  mode,
  queueIds,
  currentRecordId,
  onModeChange,
  onQueueChange,
  onCurrentRecordChange,
  onEnsureDay,
  onRate,
  onUndo,
  onRefresh,
  onOpenRecord,
  onEditRecord,
  onAddToReview,
  onRemoveReview,
  onResetReview,
}: ReviewPageProps) => {
  const touchStartYRef = useRef<number | null>(null);
  const [pullReady, setPullReady] = useState(false);
  const [filter, setFilter] = useState<ReviewCardFilter>("all");
  const [kindFilter, setKindFilter] = useState<ReviewKindFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [ratedRecordIds, setRatedRecordIds] = useState<Set<string>>(() => new Set());
  const [ratingRecordId, setRatingRecordId] = useState<string | null>(null);
  const [undoHistory, setUndoHistory] = useState<ReviewUndoEntry[]>([]);
  const [pendingUndoRestore, setPendingUndoRestore] = useState<ReviewUndoEntry | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [ratingError, setRatingError] = useState("");
  const [showAllDue, setShowAllDue] = useState(false);
  const [evaluationOpen, setEvaluationOpen] = useState(false);
  const [evaluationDraft, setEvaluationDraft] = useState("");
  const [evaluationDraftRecordId, setEvaluationDraftRecordId] = useState<string | undefined>();
  const today = todayISO();
  const [dailyLimitIds, setDailyLimitIds] = useState<string[]>(() => suggestedDailyLimitIds(dueReviews, today));
  const reviewMap = useMemo(() => new Map(reviewStates.map((review) => [review.recordId, review])), [reviewStates]);
  const availableDueReviews = useMemo(
    () => dueReviews.filter((review) => !ratedRecordIds.has(review.recordId) && isReviewDueOn(review, today)),
    [dueReviews, ratedRecordIds, today],
  );
  const queuedDueReviews = useMemo(
    () => showAllDue ? availableDueReviews : availableDueReviews.filter((review) => dailyLimitIds.includes(review.recordId)),
    [availableDueReviews, dailyLimitIds, showAllDue],
  );
  const dueIds = useMemo(() => new Set(queuedDueReviews.map((review) => review.recordId)), [queuedDueReviews]);
  const recordMap = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const effectiveQueue = useMemo(
    () => queueIds.filter((id) => dueIds.has(id) && recordMap.has(id)),
    [dueIds, queueIds, recordMap],
  );
  const currentId = currentRecordId && effectiveQueue.includes(currentRecordId) ? currentRecordId : effectiveQueue[0];
  const currentRecord = currentId ? recordMap.get(currentId) : undefined;
  const currentReview = currentId ? queuedDueReviews.find((review) => review.recordId === currentId) : undefined;
  const currentReviewLogs = currentId ? reviewLogsByRecord[currentId] ?? EMPTY_REVIEW_LOGS : EMPTY_REVIEW_LOGS;
  const currentEvaluationLogs = useMemo(
    () => currentReviewLogs.filter(hasEvaluationText),
    [currentReviewLogs],
  );
  const currentIndex = currentId ? effectiveQueue.indexOf(currentId) + 1 : 0;
  const overdueCount = availableDueReviews.filter((review) => review.nextReviewDate && review.nextReviewDate < today).length;
  const todayCount = availableDueReviews.filter((review) => review.nextReviewDate === today).length;
  const hiddenDueCount = showAllDue ? 0 : availableDueReviews.filter((review) => !dailyLimitIds.includes(review.recordId)).length;
  const queueReady = showAllDue || availableDueReviews.length === 0 || dailyLimitIds.length > 0;
  const ratingPreviews = useMemo(
    () => currentReview ? new Map(previewReviewRatings(currentReview, today).map((preview) => [preview.rating, preview])) : new Map(),
    [currentReview, today],
  );
  const subjects = useMemo(() => Array.from(new Set(records.map((record) => record.subject))).sort(), [records]);
  const newCount = records.filter((record) => {
    const review = reviewMap.get(record.id);
    return !review || review.status === "removed";
  }).length;

  const managedRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return records
      .filter((record) => subjectFilter === "all" || record.subject === subjectFilter)
      .filter((record) => matchesFilter(reviewMap.get(record.id), filter, today))
      .filter((record) => kindFilter === "all" || (reviewMap.get(record.id)?.reviewKind ?? "overview") === kindFilter)
      .filter((record) =>
        !normalizedQuery ||
        record.title.toLocaleLowerCase().includes(normalizedQuery) ||
        record.subject.toLocaleLowerCase().includes(normalizedQuery) ||
        record.date.includes(normalizedQuery),
      )
      .sort((a, b) => {
        const score = reviewSortScore(reviewMap.get(a.id), today) - reviewSortScore(reviewMap.get(b.id), today);
        return score || (reviewMap.get(a.id)?.nextReviewDate ?? "9999").localeCompare(reviewMap.get(b.id)?.nextReviewDate ?? "9999") || b.date.localeCompare(a.date);
      });
  }, [filter, kindFilter, query, records, reviewMap, subjectFilter, today]);

  useEffect(() => {
    void onEnsureDay(today, dueReviews.length);
  }, [onEnsureDay, today, dueReviews.length]);

  useEffect(() => {
    setShowAllDue(false);
    setDailyLimitIds([]);
  }, [today]);

  useEffect(() => {
    if (showAllDue || pendingUndoRestore) {
      return;
    }
    const nextDailyLimitIds = suggestedDailyLimitIds(dueReviews, today);
    if (!sameIds(dailyLimitIds, nextDailyLimitIds)) {
      setDailyLimitIds(nextDailyLimitIds);
    }
  }, [dailyLimitIds, dueReviews, pendingUndoRestore, showAllDue, today]);

  useEffect(() => {
    if (!queueReady || pendingUndoRestore) {
      return;
    }
    const nextQueue = effectiveQueue.length > 0 ? effectiveQueue : queuedDueReviews.map((review) => review.recordId).filter((id) => recordMap.has(id));
    if (nextQueue.join("|") !== queueIds.join("|")) {
      onQueueChange(nextQueue);
    }
    if (nextQueue.length > 0 && (!currentRecordId || !nextQueue.includes(currentRecordId))) {
      onCurrentRecordChange(nextQueue[0]);
    }
    if (nextQueue.length === 0 && currentRecordId) {
      onCurrentRecordChange(undefined);
    }
  }, [currentRecordId, effectiveQueue, onCurrentRecordChange, onQueueChange, pendingUndoRestore, queueIds, queueReady, queuedDueReviews, recordMap]);

  useEffect(() => {
    setRatedRecordIds(new Set());
    setUndoHistory([]);
    setPendingUndoRestore(null);
  }, [today]);

  useEffect(() => {
    const savedDraft = currentId ? readReviewEvaluationDraft(currentId) : "";
    setEvaluationDraft(savedDraft);
    setEvaluationDraftRecordId(currentId);
    setEvaluationOpen(Boolean(savedDraft));
  }, [currentId]);

  useEffect(() => {
    if (!currentId || evaluationDraftRecordId !== currentId) {
      return;
    }
    writeReviewEvaluationDraft(currentId, evaluationDraft);
  }, [currentId, evaluationDraft, evaluationDraftRecordId]);

  useEffect(() => {
    setRatedRecordIds((current) => {
      const next = new Set(
        Array.from(current).filter((id) =>
          dueReviews.some((review) => review.recordId === id && isReviewDueOn(review, today)),
        ),
      );
      if (next.size === current.size && Array.from(next).every((id) => current.has(id))) {
        return current;
      }
      return next;
    });
  }, [dueReviews, today]);

  useEffect(() => {
    if (!pendingUndoRestore) {
      return;
    }
    const restoredCardIsDue = dueReviews.some(
      (review) => review.recordId === pendingUndoRestore.currentRecordId && isReviewDueOn(review, today),
    );
    const restoredDailyScopeIsReady =
      showAllDue === pendingUndoRestore.showAllDue &&
      (showAllDue || sameIds(dailyLimitIds, pendingUndoRestore.dailyLimitIds));
    if (restoredCardIsDue && !ratedRecordIds.has(pendingUndoRestore.currentRecordId) && restoredDailyScopeIsReady) {
      setPendingUndoRestore(null);
    }
  }, [dailyLimitIds, dueReviews, pendingUndoRestore, ratedRecordIds, showAllDue, today]);

  const rate = async (rating: RecordReviewRating) => {
    if (!currentId || ratingRecordId || undoing || pendingUndoRestore) {
      return;
    }
    const ratedId = currentId;
    const previousQueue = effectiveQueue;
    const previousCurrentId = currentId;
    const nextQueue = effectiveQueue.filter((id) => id !== currentId);
    const evaluationText = evaluationDraftRecordId === ratedId
      ? evaluationDraft.trim()
      : readReviewEvaluationDraft(ratedId).trim();
    if (evaluationText) {
      writeReviewEvaluationDraft(ratedId, evaluationText);
    }
    setRatingError("");
    setRatingRecordId(ratedId);
    setRatedRecordIds((current) => new Set(current).add(ratedId));
    onQueueChange(nextQueue);
    onCurrentRecordChange(nextQueue[0]);
    try {
      if (evaluationText) {
        const token = await onRate(ratedId, rating, evaluationText);
        if (token) {
          setUndoHistory((current) => [
            ...current,
            {
              token,
              queueIds: previousQueue,
              currentRecordId: previousCurrentId,
              evaluationText,
              dailyLimitIds,
              showAllDue,
            },
          ]);
        }
      } else {
        const token = await onRate(ratedId, rating);
        if (token) {
          setUndoHistory((current) => [
            ...current,
            {
              token,
              queueIds: previousQueue,
              currentRecordId: previousCurrentId,
              evaluationText,
              dailyLimitIds,
              showAllDue,
            },
          ]);
        }
      }
      removeReviewEvaluationDraft(ratedId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setRatedRecordIds((current) => {
        const next = new Set(current);
        next.delete(ratedId);
        return next;
      });
      onQueueChange(previousQueue);
      onCurrentRecordChange(previousCurrentId);
      setRatingError(`复习评分失败：${message}`);
    } finally {
      setRatingRecordId(null);
    }
  };

  const undoLastRating = useCallback(async () => {
    const entry = undoHistory[undoHistory.length - 1];
    if (!entry || ratingRecordId || undoing || pendingUndoRestore) {
      return;
    }

    setRatingError("");
    setUndoing(true);
    setPendingUndoRestore(entry);
    try {
      await onUndo(entry.token);
      setUndoHistory((current) => current.slice(0, -1));
      setRatedRecordIds((current) => {
        const next = new Set(current);
        next.delete(entry.currentRecordId);
        return next;
      });
      if (entry.evaluationText) {
        writeReviewEvaluationDraft(entry.currentRecordId, entry.evaluationText);
      } else {
        removeReviewEvaluationDraft(entry.currentRecordId);
      }
      setEvaluationDraft(entry.evaluationText);
      setEvaluationDraftRecordId(entry.currentRecordId);
      setEvaluationOpen(Boolean(entry.evaluationText));
      setShowAllDue(entry.showAllDue);
      setDailyLimitIds(entry.dailyLimitIds);
      onModeChange("queue");
      onQueueChange(entry.queueIds);
      onCurrentRecordChange(entry.currentRecordId);
    } catch (error) {
      setPendingUndoRestore(null);
      const message = error instanceof Error ? error.message : "未知错误";
      setRatingError(`撤回评分失败：${message}`);
    } finally {
      setUndoing(false);
    }
  }, [onCurrentRecordChange, onModeChange, onQueueChange, onUndo, pendingUndoRestore, ratingRecordId, undoHistory, undoing]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditable = target instanceof HTMLElement && (
        target.matches("input, textarea, [contenteditable='true']") ||
        Boolean(target.closest("[contenteditable='true']"))
      );
      if (
        event.key.toLowerCase() !== "z" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.shiftKey ||
        isEditable ||
        undoHistory.length === 0 ||
        Boolean(ratingRecordId) ||
        undoing ||
        Boolean(pendingUndoRestore)
      ) {
        return;
      }
      event.preventDefault();
      void undoLastRating();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingUndoRestore, ratingRecordId, undoHistory.length, undoLastRating, undoing]);

  const continueRemainingDue = () => {
    const nextQueue = availableDueReviews.map((review) => review.recordId).filter((id) => recordMap.has(id));
    setShowAllDue(true);
    onQueueChange(nextQueue);
    onCurrentRecordChange(nextQueue[0]);
  };

  const touchStart = (clientY: number) => {
    touchStartYRef.current = window.scrollY <= 0 ? clientY : null;
    setPullReady(false);
  };

  const touchMove = (clientY: number) => {
    if (touchStartYRef.current === null) {
      return;
    }
    setPullReady(clientY - touchStartYRef.current > 72);
  };

  const touchEnd = () => {
    const shouldRefresh = pullReady;
    touchStartYRef.current = null;
    setPullReady(false);
    if (shouldRefresh) {
      void onRefresh();
    }
  };

  return (
    <main
      className="page review-page"
      onTouchStart={(event) => touchStart(event.touches[0]?.clientY ?? 0)}
      onTouchMove={(event) => touchMove(event.touches[0]?.clientY ?? 0)}
      onTouchEnd={touchEnd}
    >
      <PageHeader
        eyebrow="Review"
        title="间隔复习"
        subtitle={`今日到期 ${todayCount} 条，已过期 ${overdueCount} 条`}
        actions={(
          <>
            <button
              type="button"
              className="secondary-button review-undo-button"
              onClick={() => void undoLastRating()}
              disabled={undoHistory.length === 0 || Boolean(ratingRecordId) || undoing || Boolean(pendingUndoRestore)}
              aria-keyshortcuts="Control+Z Meta+Z"
              title="撤回上次评分（Ctrl+Z）"
            >
              <Undo2 size={17} />
              撤回
            </button>
            <button type="button" className="secondary-button" onClick={() => void onRefresh()}>
              <RefreshCw size={17} />
              刷新
            </button>
          </>
        )}
      />
      {pullReady && <p className="status-message">松手刷新复习列表</p>}
      {ratingError && <p className="status-message">{ratingError}</p>}

      <div className="review-mode-tabs" role="tablist" aria-label="复习视图">
        <button type="button" className={mode === "queue" ? "active" : ""} onClick={() => onModeChange("queue")}>
          今日复习
        </button>
        <button type="button" className={mode === "manage" ? "active" : ""} onClick={() => onModeChange("manage")}>
          卡片管理
        </button>
      </div>

      <section className="review-summary-grid">
        <SurfaceCard variant="raised">
          <span>复习中</span>
          <strong>{stats?.activeCount ?? 0}</strong>
        </SurfaceCard>
        <SurfaceCard variant="raised">
          <span>新卡</span>
          <strong>{newCount}</strong>
        </SurfaceCard>
        <SurfaceCard variant="raised">
          <span>已掌握</span>
          <strong>{stats?.masteredCount ?? 0}</strong>
        </SurfaceCard>
      </section>

      {mode === "queue" ? (
        !currentRecord ? (
          <section className="empty-state review-empty-state">
            <h2>{hiddenDueCount > 0 ? "今日建议已完成" : "今天暂无待复习"}</h2>
            <p>
              {hiddenDueCount > 0
                ? `还有 ${hiddenDueCount} 条到期记录，已经超出今日建议量。`
                : "你可以从日志卡片或卡片管理里把重要笔记加入复习队列。"}
            </p>
            <small>累计复习 {stats?.totalReviews ?? 0} 次</small>
            {hiddenDueCount > 0 && (
              <button type="button" className="primary-button" onClick={continueRemainingDue}>
                继续处理剩余
              </button>
            )}
          </section>
        ) : (
          <>
            <section className="review-progress-panel">
              <span>第 {currentIndex}/{effectiveQueue.length} 条</span>
              <strong>{currentReview?.nextReviewDate && currentReview.nextReviewDate < today ? "已过期" : "今日到期"}</strong>
              <small>{reviewKindLabel(currentReview?.reviewKind)} · 累计 {currentReview?.totalReviews ?? 0} 次</small>
            </section>
            <article className="review-record-card">
              <header className="record-view-header">
                <p className="eyebrow">{currentRecord.date}</p>
                <h1>{currentRecord.title}</h1>
                <span>{currentRecord.subject} · {reviewKindLabel(currentReview?.reviewKind)}</span>
              </header>
              <RichTextEditor
                value={normalizeRecordContent(currentRecord)}
                onChange={() => undefined}
                placeholder=""
                readOnly
              />
            </article>
            <section className={`review-bottom-controls ${evaluationOpen ? "open" : ""}`}>
              <section className="review-evaluation-panel" aria-label="复习评价">
                <button
                  type="button"
                  className="review-evaluation-toggle"
                  onClick={() => setEvaluationOpen((open) => !open)}
                  aria-expanded={evaluationOpen}
                >
                  <MessageSquare size={17} />
                  <span>
                    <strong>本次评价</strong>
                    <small>
                      {evaluationDraft.trim()
                        ? "草稿已保存"
                        : currentEvaluationLogs.length > 0
                          ? `${currentEvaluationLogs.length} 条历史评价`
                          : "暂无评价"}
                    </small>
                  </span>
                  <ChevronDown size={17} />
                </button>
                {evaluationOpen && (
                  <div className="review-evaluation-body">
                    <textarea
                      value={evaluationDraft}
                      onChange={(event) => setEvaluationDraft(event.target.value)}
                      disabled={Boolean(ratingRecordId) || undoing || Boolean(pendingUndoRestore)}
                      aria-label="本次复习评价"
                      placeholder="新的理解、掌握程度、待补点..."
                    />
                    <div className="review-evaluation-state">
                      <small>{evaluationDraft.trim() ? "评分后写入历史评价" : "评分时随卡片提交"}</small>
                      {currentEvaluationLogs.length > 0 && <small>{currentEvaluationLogs.length} 条历史评价</small>}
                    </div>
                    {currentEvaluationLogs.length > 0 && (
                      <div className="review-evaluation-history">
                        {currentEvaluationLogs.slice(0, 8).map((log) => (
                          <article key={log.id}>
                            <strong>{isoDateTimeToLocalDate(log.reviewedAt)} · {ratingLabel(log.rating)}</strong>
                            <p>{log.evaluationText}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
              <section className="review-rating-bar">
                {ratingConfig.map((item) => {
                  const Icon = item.icon;
                  const preview = ratingPreviews.get(item.rating as typeof ACTIVE_REVIEW_RATINGS[number]);
                  const intervalText = preview ? intervalLabel(preview.intervalDays) : undefined;
                  return (
                    <button
                      key={item.rating}
                      type="button"
                      className={item.className}
                      disabled={Boolean(ratingRecordId) || undoing || Boolean(pendingUndoRestore)}
                      onClick={() => void rate(item.rating)}
                      aria-label={intervalText ? `${item.label}，${intervalText}` : item.label}
                      title={intervalText ? `${item.label} · ${intervalText}` : item.label}
                    >
                      <Icon size={18} />
                      <span>{item.label}</span>
                      {intervalText && <small>{intervalText}</small>}
                    </button>
                  );
                })}
              </section>
            </section>
          </>
        )
      ) : (
        <section className="review-manager">
          <div className="review-manager-toolbar">
            <label className="review-search-box">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、日期、牌组" />
            </label>
            <select value={filter} onChange={(event) => setFilter(event.target.value as ReviewCardFilter)} aria-label="卡片状态">
              <option value="all">全部卡片</option>
              <option value="due">到期</option>
              <option value="new">新卡</option>
              <option value="active">复习中</option>
              <option value="suspended">已搁置</option>
              <option value="mastered">已掌握</option>
            </select>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as ReviewKindFilter)} aria-label="复习类型">
              <option value="all">全部类型</option>
              <option value="overview">轻回看</option>
              <option value="memory">记忆卡</option>
            </select>
            <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} aria-label="所属牌组">
              <option value="all">全部牌组</option>
              {subjects.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </div>
          <div className="review-manager-list">
            {managedRecords.length === 0 ? (
              <div className="empty-state">
                <h2>没有匹配的卡片</h2>
                <p>换一个筛选条件，或者先从日志里加入复习。</p>
              </div>
            ) : managedRecords.map((record) => {
              const review = reviewMap.get(record.id);
              const hasEvaluation = (reviewLogsByRecord[record.id] ?? EMPTY_REVIEW_LOGS).some(hasEvaluationText);
              const status = reviewStatusLabel(review, today);
              const dueLabel = reviewDueLabel(review);
              const active = review?.status === "active";
              return (
                <article key={record.id} className="review-manager-card">
                  <div className="review-manager-main">
                    <span className="record-subject-chip">{record.subject}</span>
                    <div>
                      <strong>{record.title}</strong>
                      <small>
                        {record.date} · {reviewKindLabel(review?.reviewKind)} · {dueLabel} · 累计 {review?.totalReviews ?? 0} 次
                        {hasEvaluation && (
                          <span className="review-evaluation-inline-indicator" title="有复习评价" aria-label="有复习评价">
                            <MessageSquare size={14} />
                          </span>
                        )}
                      </small>
                    </div>
                  </div>
                  <span className={`review-status-pill ${status === "新卡" || status === "已搁置" ? "new" : active ? "active" : "done"}`}>
                    {status}
                  </span>
                  <div className="review-manager-actions">
                    <button type="button" className="secondary-button" onClick={() => onOpenRecord(record)}>
                      <Eye size={16} />
                      预览
                    </button>
                    <button type="button" className="secondary-button" onClick={() => onEditRecord(record)}>
                      <Edit3 size={16} />
                      编辑
                    </button>
                    {!active && (
                      <button type="button" className="secondary-button" onClick={() => void onAddToReview(record.id)}>
                        <PlusCircle size={16} />
                        加入复习
                      </button>
                    )}
                    {review && (
                      <button type="button" className="secondary-button" onClick={() => void onResetReview(record.id)}>
                        <RotateCcw size={16} />
                        忘记重排
                      </button>
                    )}
                    {active && (
                      <button type="button" className="secondary-button danger" onClick={() => void onRemoveReview(record.id)}>
                        <PauseCircle size={16} />
                        搁置
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
};
