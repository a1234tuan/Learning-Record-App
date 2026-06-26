import { CheckCircle2, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { RecordBlock, RecordReviewRating, RecordReviewState, RecordReviewStats } from "../types";
import { RichTextEditor } from "../components/RichTextEditor";
import { PageHeader, SurfaceCard } from "../components/ui";
import { normalizeRecordContent } from "../lib/recordContent";
import { todayISO } from "../lib/date";

interface ReviewPageProps {
  records: RecordBlock[];
  dueReviews: RecordReviewState[];
  stats: RecordReviewStats | null;
  queueIds: string[];
  currentRecordId?: string;
  onQueueChange: (ids: string[]) => void;
  onCurrentRecordChange: (id?: string) => void;
  onEnsureDay: (date: string, dueCountAtFirstOpen: number) => Promise<unknown>;
  onRate: (recordId: string, rating: RecordReviewRating) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const ratingConfig: Array<{ rating: RecordReviewRating; label: string; icon: typeof CheckCircle2; className: string }> = [
  { rating: "remembered", label: "记住了", icon: CheckCircle2, className: "remembered" },
  { rating: "fuzzy", label: "模糊", icon: Sparkles, className: "fuzzy" },
  { rating: "forgot", label: "忘了", icon: XCircle, className: "forgot" },
];

export const ReviewPage = ({
  records,
  dueReviews,
  stats,
  queueIds,
  currentRecordId,
  onQueueChange,
  onCurrentRecordChange,
  onEnsureDay,
  onRate,
  onRefresh,
}: ReviewPageProps) => {
  const touchStartYRef = useRef<number | null>(null);
  const [pullReady, setPullReady] = useState(false);
  const today = todayISO();
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

  useEffect(() => {
    void onEnsureDay(today, dueReviews.length);
  }, [dueReviews.length, onEnsureDay, today]);

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
    await onRate(currentId, rating);
    const nextQueue = effectiveQueue.filter((id) => id !== currentId);
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
          <button type="button" className="secondary-button" onClick={() => void onRefresh()}>
            <RefreshCw size={17} />
            刷新
          </button>
        )}
      />
      {pullReady && <p className="status-message">松手刷新复习列表</p>}

      <section className="review-summary-grid">
        <SurfaceCard variant="raised">
          <span>复习中</span>
          <strong>{stats?.activeCount ?? 0}</strong>
        </SurfaceCard>
        <SurfaceCard variant="raised">
          <span>已掌握</span>
          <strong>{stats?.masteredCount ?? 0}</strong>
        </SurfaceCard>
        <SurfaceCard variant="raised">
          <span>连续打卡</span>
          <strong>{stats?.streakDays ?? 0} 天</strong>
        </SurfaceCard>
      </section>

      {!currentRecord ? (
        <section className="empty-state review-empty-state">
          <h2>今天暂无待复习</h2>
          <p>你可以从记录卡片或详情页把重要笔记加入复习队列。</p>
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
                <button key={item.rating} type="button" className={item.className} onClick={() => void rate(item.rating)}>
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
};
