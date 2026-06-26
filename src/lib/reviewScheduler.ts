import type { ISODate, ISODateTime, RecordReviewRating, RecordReviewState } from "../types";
import { addDaysISO } from "./date";

export const REVIEW_MASTERY_TARGET = 5;
export const DEFAULT_REVIEW_EASE = 2.5;
export const MIN_REVIEW_EASE = 1.3;

export interface ReviewScheduleResult {
  state: RecordReviewState;
  nextReviewDate?: ISODate;
}

export const qualityForRating = (rating: RecordReviewRating): number => {
  switch (rating) {
    case "remembered":
      return 5;
    case "fuzzy":
      return 3;
    case "forgot":
      return 1;
  }
};

export const nextEaseFactor = (easeFactor: number, quality: number): number => {
  const next = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  return Math.max(MIN_REVIEW_EASE, Number(next.toFixed(4)));
};

export const applySm2Review = (
  state: RecordReviewState,
  rating: RecordReviewRating,
  reviewedDate: ISODate,
  reviewedAt: ISODateTime,
): ReviewScheduleResult => {
  const quality = qualityForRating(rating);
  const easeFactor = nextEaseFactor(state.easeFactor, quality);
  const remembered = rating === "remembered";
  const consecutiveRemembered = remembered ? state.consecutiveRemembered + 1 : 0;

  if (consecutiveRemembered >= REVIEW_MASTERY_TARGET) {
    return {
      state: {
        ...state,
        status: "mastered",
        easeFactor,
        repetition: state.repetition + 1,
        intervalDays: state.intervalDays,
        nextReviewDate: undefined,
        lastReviewDate: reviewedDate,
        lastReviewedAt: reviewedAt,
        consecutiveRemembered,
        totalReviews: state.totalReviews + 1,
      },
    };
  }

  if (quality < 3) {
    const nextReviewDate = addDaysISO(reviewedDate, 1);
    return {
      nextReviewDate,
      state: {
        ...state,
        status: "active",
        easeFactor,
        repetition: 0,
        intervalDays: 1,
        nextReviewDate,
        lastReviewDate: reviewedDate,
        lastReviewedAt: reviewedAt,
        consecutiveRemembered: 0,
        totalReviews: state.totalReviews + 1,
      },
    };
  }

  const nextRepetition = state.repetition + 1;
  const intervalDays = nextRepetition === 1
    ? 1
    : nextRepetition === 2
      ? 6
      : Math.max(1, Math.round(state.intervalDays * easeFactor));
  const nextReviewDate = addDaysISO(reviewedDate, intervalDays);
  return {
    nextReviewDate,
    state: {
      ...state,
      status: "active",
      easeFactor,
      repetition: nextRepetition,
      intervalDays,
      nextReviewDate,
      lastReviewDate: reviewedDate,
      lastReviewedAt: reviewedAt,
      consecutiveRemembered,
      totalReviews: state.totalReviews + 1,
    },
  };
};
