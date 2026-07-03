import {
  CheckCircle2,
  Edit3,
  Eye,
  PauseCircle,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { RecordBlock, RecordReviewRating, RecordReviewState, RecordReviewStats } from "../types";
import { RichTextEditor } from "../components/RichTextEditor";
import { PageHeader, SurfaceCard } from "../components/ui";
import { normalizeRecordContent } from "../lib/recordContent";
import { todayISO } from "../lib/date";
import type { ReviewMode } from "../lib/tabNavigation";

interface ReviewPageProps {
  records: RecordBlock[];
  dueReviews: RecordReviewState[];
  reviewStates: RecordReviewState[];
  stats: RecordReviewStats | null;
  mode: ReviewMode;
  queueIds: string[];
  currentRecordId?: string;
  onModeChange: (mode: ReviewMode) => void;
  onQueueChange: (ids: string[]) => void;
  onCurrentRecordChange: (id?: string) => void;
  onEnsureDay: (date: string, dueCountAtFirstOpen: number) => Promise<unknown>;
  onRate: (recordId: string, rating: RecordReviewRating) => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenRecord: (record: RecordBlock) => void;
  onEditRecord: (record: RecordBlock) => void;
  onAddToReview: (recordId: string) => Promise<void> | void;
  onRemoveReview: (recordId: string) => Promise<void> | void;
  onResetReview: (recordId: string) => Promise<void> | void;
}

type ReviewCardFilter = "all" | "due" | "new" | "active" | "suspended" | "mastered";

const ratingConfig: Array<{ rating: RecordReviewRating; label: string; icon: typeof CheckCircle2; className: string }> = [
  { rating: "remembered", label: "记住了", icon: CheckCircle2, className: "remembered" },
  { rating: "fuzzy", label: "模糊", icon: Sparkles, className: "fuzzy" },
  { rating: "forgot", label: "忘记了", icon: XCircle, className: "forgot" },
];

const isDueReview = (review: RecordReviewState | undefined, today: string) =>
  review?.status === "active" && typeof review.nextReviewDate === "string" && review.nextReviewDate <= today;

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
  stats,
  mode,
  queueIds,
  currentRecordId,
  onModeChange,
  onQueueChange,
  onCurrentRecordChange,
  onEnsureDay,
  onRate,
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
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [query, setQuery] = useState("");
  const today = todayISO();
  const reviewMap = useMemo(() => new Map(reviewStates.map((review) => [review.recordId, review])), [reviewStates]);
  const dueIds = useMemo(() => new Set(dueReviews.map((review) => review.recordId)), [dueReviews]);
  const recordMap = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const effectiveQueue = useMemo(
    () => queueIds.filter((id) => dueIds.has(id) && recordMap.has(id)),
    [dueIds, queueIds, recordMap],
  );
  const currentId = currentRecordId && effectiveQueue.includes(currentRecordId) ? currentRecordId : effectiveQueue[0];
  const currentRecord = currentId ? recordMap.get(currentId) : undefined;
  const currentReview = currentId ? dueReviews.find((review) => review.recordId === currentId) : undefined;
  const currentIndex = currentId ? effectiveQueue.indexOf(currentId) + 1 : 0;
  const overdueCount = dueReviews.filter((review) => review.nextReviewDate && review.nextReviewDate < today).length;
  const todayCount = dueReviews.filter((review) => review.nextReviewDate === today).length;
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
  }, [filter, query, records, reviewMap, subjectFilter, today]);

  useEffect(() => {
    void onEnsureDay(today, dueReviews.length);
  }, [onEnsureDay, today, dueReviews.length]);

  useEffect(() => {
    const nextQueue = effectiveQueue.length > 0 ? effectiveQueue : dueReviews.map((review) => review.recordId).filter((id) => recordMap.has(id));
    if (nextQueue.join("|") !== queueIds.join("|")) {
      onQueueChange(nextQueue);
    }
    if (nextQueue.length > 0 && (!currentRecordId || !nextQueue.includes(currentRecordId))) {
      onCurrentRecordChange(nextQueue[0]);
    }
    if (nextQueue.length === 0 && currentRecordId) {
      onCurrentRecordChange(undefined);
    }
  }, [currentRecordId, dueReviews, effectiveQueue, onCurrentRecordChange, onQueueChange, queueIds, recordMap]);

  const rate = async (rating: RecordReviewRating) => {
    if (!currentId) {
      return;
    }
    const nextQueue = effectiveQueue.filter((id) => id !== currentId);
    onQueueChange(nextQueue);
    onCurrentRecordChange(nextQueue[0]);
    await onRate(currentId, rating);
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
          <button type="button" className="secondary-button" onClick={() => void onRefresh()}>
            <RefreshCw size={17} />
            刷新
          </button>
        )}
      />
      {pullReady && <p className="status-message">松手刷新复习列表</p>}

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
            <h2>今天暂无待复习</h2>
            <p>你可以从日志卡片或卡片管理里把重要笔记加入复习队列。</p>
            <small>累计复习 {stats?.totalReviews ?? 0} 次</small>
          </section>
        ) : (
          <>
            <section className="review-progress-panel">
              <span>第 {currentIndex}/{effectiveQueue.length} 条</span>
              <strong>{currentReview?.nextReviewDate && currentReview.nextReviewDate < today ? "已过期" : "今日到期"}</strong>
              <small>连续记住 {currentReview?.consecutiveRemembered ?? 0}/5</small>
            </section>
            <article className="review-record-card">
              <header className="record-view-header">
                <p className="eyebrow">{currentRecord.date}</p>
                <h1>{currentRecord.title}</h1>
                <span>{currentRecord.subject}</span>
              </header>
              <RichTextEditor
                value={normalizeRecordContent(currentRecord)}
                onChange={() => undefined}
                placeholder=""
                readOnly
              />
            </article>
            <section className="review-rating-bar">
              {ratingConfig.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.rating}
                    type="button"
                    className={item.className}
                    onClick={() => void rate(item.rating)}
                  >
                    <Icon size={18} />
                    {item.label}
                  </button>
                );
              })}
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
              const status = reviewStatusLabel(review, today);
              const dueLabel = reviewDueLabel(review);
              const active = review?.status === "active";
              return (
                <article key={record.id} className="review-manager-card">
                  <div className="review-manager-main">
                    <span className="record-subject-chip">{record.subject}</span>
                    <div>
                      <strong>{record.title}</strong>
                      <small>{record.date} · {dueLabel} · 连续记住 {review?.consecutiveRemembered ?? 0}/5</small>
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
