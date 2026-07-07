import { BrainCircuit, FileText, MessageSquare, RefreshCw, Star } from "lucide-react";

import type { RecordBlock, RecordReviewLog, RecordReviewState } from "../types";
import { todayISO } from "../lib/date";
import { isReviewDueOn, reviewKindLabel } from "../lib/reviewScheduler";

interface RecordCardProps {
  record: RecordBlock;
  onOpen: (record: RecordBlock) => void;
  onAskAi?: (date: string) => void;
  onToggleFavorite?: (favorite: boolean) => void;
  reviewState?: RecordReviewState;
  reviewLogs?: RecordReviewLog[];
  onAddReview?: () => void;
}

const reviewLabel = (review?: RecordReviewState): string => {
  if (!review || review.status === "removed") return "加入复习";
  if (review.status === "mastered") return "已掌握";
  if (isReviewDueOn(review, todayISO())) return "待复习";
  return review.nextReviewDate ? `${reviewKindLabel(review.reviewKind)} ${review.nextReviewDate.slice(5)}` : reviewKindLabel(review.reviewKind);
};

const compactReviewLabel = (review?: RecordReviewState): string => {
  if (!review || review.status === "removed") return "加入";
  if (review.status === "mastered") return "掌握";
  if (isReviewDueOn(review, todayISO())) return "复习";
  return review.reviewKind === "memory" ? "记忆" : "回看";
};

export const RecordCard = ({ record, onOpen, onAskAi, onToggleFavorite, reviewState, reviewLogs = [], onAddReview }: RecordCardProps) => {
  const assetText = record.assets.length > 0 ? `${record.assets.length} 个资源` : "无资源";
  const formulaText = record.formulas.length > 0 ? `${record.formulas.length} 个公式` : "无公式";
  const canAddReview = onAddReview && (!reviewState || reviewState.status === "removed" || reviewState.status === "mastered");
  const reviewActive = reviewState?.status === "active";
  const reviewDue = isReviewDueOn(reviewState, todayISO());
  const hasReviewEvaluation = reviewLogs.some((log) => Boolean(log.evaluationText?.trim()));

  return (
    <article className="record-card">
      <div className="record-card-header">
        <span className="record-subject-chip" title={record.subject}>
          {record.subject}
        </span>
        <div className="record-card-actions" aria-label="记录操作">
          {onAskAi && (
            <button
              type="button"
              className="record-ai-button"
              onClick={() => onAskAi(record.date)}
              aria-label={`AI问答 ${record.date}`}
              title="AI问答"
            >
              <BrainCircuit size={16} />
            </button>
          )}
          {onAddReview && (
            <button
              type="button"
              className={`record-review-button ${reviewActive ? "active" : ""} ${reviewDue ? "due" : ""} ${reviewState?.status === "mastered" ? "mastered" : ""}`}
              onClick={() => {
                if (canAddReview) onAddReview();
              }}
              aria-label={`${reviewLabel(reviewState)} ${record.title}`}
              title={reviewLabel(reviewState)}
            >
              <RefreshCw size={15} />
              <span>{compactReviewLabel(reviewState)}</span>
            </button>
          )}
          {onToggleFavorite && (
            <button
              type="button"
              className={`record-favorite-button ${record.favorite ? "active" : ""}`}
              onClick={() => onToggleFavorite(!record.favorite)}
              aria-label={record.favorite ? "取消收藏" : "收藏记录"}
              title={record.favorite ? "取消收藏" : "收藏记录"}
            >
              <Star size={16} fill={record.favorite ? "currentColor" : "none"} />
            </button>
          )}
          {hasReviewEvaluation && (
            <span className="record-evaluation-indicator" title="有复习评价" aria-label="有复习评价" role="img">
              <MessageSquare size={15} />
            </span>
          )}
        </div>
      </div>
      <button type="button" className="record-card-main" onClick={() => onOpen(record)}>
        <span className="record-card-icon">
          <FileText size={18} />
        </span>
        <div className="record-card-copy">
          <strong>{record.title}</strong>
          <small>
            {record.date} · {assetText} · {formulaText}
          </small>
        </div>
      </button>
    </article>
  );
};
