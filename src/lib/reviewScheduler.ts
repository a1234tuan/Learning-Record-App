import { differenceInCalendarDays, parseISO } from "date-fns";
import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from "ts-fsrs";

import type {
  ISODate,
  ISODateTime,
  RecordReviewFsrsCard,
  RecordReviewKind,
  RecordReviewRating,
  RecordReviewScheduler,
  RecordReviewState,
} from "../types";
import { addDaysISO, toISODate } from "./date";

export const REVIEW_DAILY_SUGGESTED_LIMIT = 20;
export const REVIEW_MASTERY_TARGET = 5;
export const DEFAULT_REVIEW_EASE = 2.5;
export const MIN_REVIEW_EASE = 1.3;
export const FSRS_MAX_INTERVAL_DAYS = 365;
export const DEFAULT_REVIEW_KIND: RecordReviewKind = "overview";
export const OVERVIEW_REVIEW_SCHEDULER: RecordReviewScheduler = "overview-v1";
export const FSRS_REVIEW_SCHEDULER: RecordReviewScheduler = "fsrs-v6";

export const ACTIVE_REVIEW_RATINGS = ["forgot", "fuzzy", "good", "easy"] as const;
export type ActiveRecordReviewRating = typeof ACTIVE_REVIEW_RATINGS[number];

export interface ReviewScheduleResult {
  state: RecordReviewState;
  nextReviewDate?: ISODate;
}

export interface ReviewRatingPreview {
  rating: ActiveRecordReviewRating;
  intervalDays: number;
  nextReviewDate: ISODate;
}

const fsrsScheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: FSRS_MAX_INTERVAL_DAYS,
  enable_fuzz: false,
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
});

const dateForISO = (date: ISODate): Date => new Date(`${date}T00:00:00`);

const intervalBetween = (from: ISODate, to: ISODate): number =>
  Math.max(1, differenceInCalendarDays(parseISO(to), parseISO(from)));

export const normalizeLegacyRating = (rating: RecordReviewRating): ActiveRecordReviewRating =>
  rating === "remembered" ? "good" : rating;

export const reviewKindForState = (state: RecordReviewState | undefined): RecordReviewKind =>
  state?.reviewKind ?? DEFAULT_REVIEW_KIND;

export const schedulerForKind = (kind: RecordReviewKind): RecordReviewScheduler =>
  kind === "memory" ? FSRS_REVIEW_SCHEDULER : OVERVIEW_REVIEW_SCHEDULER;

export const reviewKindLabel = (kind: RecordReviewKind | undefined): string =>
  (kind ?? DEFAULT_REVIEW_KIND) === "memory" ? "记忆卡" : "轻回看";

export const ratingLabel = (rating: RecordReviewRating): string => {
  switch (normalizeLegacyRating(rating)) {
    case "forgot":
      return "忘记了";
    case "fuzzy":
      return "模糊";
    case "good":
      return "良好";
    case "easy":
      return "轻松";
  }
};

const nextFromLadder = (currentIntervalDays: number, ladder: number[]): number => {
  const safeCurrent = Math.max(0, currentIntervalDays);
  for (const step of ladder) {
    if (safeCurrent < step) {
      return step;
    }
  }
  return ladder[latterIndex(ladder)];
};

const latterIndex = <T,>(items: T[]): number => Math.max(0, items.length - 1);

export const overviewIntervalForRating = (
  rating: RecordReviewRating,
  currentIntervalDays: number,
): number => {
  switch (normalizeLegacyRating(rating)) {
    case "forgot":
      return 1;
    case "fuzzy":
      if (currentIntervalDays <= 4) return 4;
      if (currentIntervalDays <= 7) return 7;
      if (currentIntervalDays <= 21) return 14;
      return 21;
    case "good":
      return nextFromLadder(currentIntervalDays, [10, 21, 45, 90, 180]);
    case "easy":
      return nextFromLadder(currentIntervalDays, [21, 60, 120, 365]);
  }
};

export const qualityForRating = (rating: RecordReviewRating): number => {
  switch (normalizeLegacyRating(rating)) {
    case "easy":
      return 5;
    case "good":
      return 4;
    case "fuzzy":
      return 3;
    case "forgot":
      return 1;
  }
};

export const isReviewDueOn = (review: RecordReviewState | undefined, date: ISODate): boolean =>
  review?.status === "active" &&
  typeof review.nextReviewDate === "string" &&
  review.nextReviewDate <= date &&
  review.lastReviewDate !== date;

export const nextEaseFactor = (easeFactor: number, quality: number): number => {
  const next = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  return Math.max(MIN_REVIEW_EASE, Number(next.toFixed(4)));
};

export const applyOverviewReview = (
  state: RecordReviewState,
  rating: RecordReviewRating,
  reviewedDate: ISODate,
  reviewedAt: ISODateTime,
): ReviewScheduleResult => {
  const normalizedRating = normalizeLegacyRating(rating);
  const quality = qualityForRating(normalizedRating);
  const easeFactor = nextEaseFactor(state.easeFactor, quality);
  const intervalDays = overviewIntervalForRating(normalizedRating, state.intervalDays);
  const nextReviewDate = addDaysISO(reviewedDate, intervalDays);
  const successful = normalizedRating === "good" || normalizedRating === "easy";
  const nextRepetition = normalizedRating === "forgot" ? 0 : state.repetition + 1;

  return {
    nextReviewDate,
    state: {
      ...state,
      status: "active",
      reviewKind: "overview",
      scheduler: OVERVIEW_REVIEW_SCHEDULER,
      easeFactor,
      repetition: nextRepetition,
      intervalDays,
      nextReviewDate,
      lastReviewDate: reviewedDate,
      lastReviewedAt: reviewedAt,
      consecutiveRemembered: successful ? state.consecutiveRemembered + 1 : 0,
      totalReviews: state.totalReviews + 1,
      fsrsCard: undefined,
    },
  };
};

const serializeFsrsCard = (card: Card): RecordReviewFsrsCard => ({
  dueDate: toISODate(card.due),
  stability: Number(card.stability.toFixed(4)),
  difficulty: Number(card.difficulty.toFixed(4)),
  elapsedDays: card.elapsed_days,
  scheduledDays: card.scheduled_days,
  learningSteps: card.learning_steps,
  reps: card.reps,
  lapses: card.lapses,
  state: card.state,
  lastReviewDate: card.last_review ? toISODate(card.last_review) : undefined,
});

export const createInitialFsrsCard = (dueDate: ISODate): RecordReviewFsrsCard => {
  const card = createEmptyCard(dateForISO(dueDate));
  card.due = dateForISO(dueDate);
  card.scheduled_days = 1;
  return serializeFsrsCard(card);
};

const deserializeFsrsCard = (card: RecordReviewFsrsCard): Card => ({
  due: dateForISO(card.dueDate),
  stability: card.stability,
  difficulty: card.difficulty,
  elapsed_days: card.elapsedDays,
  scheduled_days: card.scheduledDays,
  learning_steps: card.learningSteps,
  reps: card.reps,
  lapses: card.lapses,
  state: card.state as State,
  last_review: card.lastReviewDate ? dateForISO(card.lastReviewDate) : undefined,
});

const fsrsCardForReview = (state: RecordReviewState, reviewedDate: ISODate): Card =>
  state.fsrsCard ? deserializeFsrsCard(state.fsrsCard) : createEmptyCard(dateForISO(reviewedDate));

const effectiveFsrsReviewDate = (state: RecordReviewState, reviewedDate: ISODate): ISODate => {
  const previousFsrsReviewDate = state.fsrsCard?.lastReviewDate;
  return previousFsrsReviewDate && reviewedDate < previousFsrsReviewDate ? previousFsrsReviewDate : reviewedDate;
};

const fsrsRatingFor = (rating: RecordReviewRating): Grade => {
  switch (normalizeLegacyRating(rating)) {
    case "forgot":
      return Rating.Again as Grade;
    case "fuzzy":
      return Rating.Hard as Grade;
    case "good":
      return Rating.Good as Grade;
    case "easy":
      return Rating.Easy as Grade;
  }
};

export const applyFsrsReview = (
  state: RecordReviewState,
  rating: RecordReviewRating,
  reviewedDate: ISODate,
  reviewedAt: ISODateTime,
): ReviewScheduleResult => {
  const normalizedRating = normalizeLegacyRating(rating);
  const fsrsReviewedDate = effectiveFsrsReviewDate(state, reviewedDate);
  const result = fsrsScheduler.next(
    fsrsCardForReview(state, fsrsReviewedDate),
    dateForISO(fsrsReviewedDate),
    fsrsRatingFor(normalizedRating),
  );
  const nextCard = { ...result.card };
  let nextReviewDate = toISODate(nextCard.due);
  if (nextReviewDate <= reviewedDate) {
    nextReviewDate = addDaysISO(reviewedDate, 1);
    nextCard.due = dateForISO(nextReviewDate);
    nextCard.scheduled_days = 1;
  }
  const maxReviewDate = addDaysISO(reviewedDate, FSRS_MAX_INTERVAL_DAYS);
  if (nextReviewDate > maxReviewDate) {
    nextReviewDate = maxReviewDate;
    nextCard.due = dateForISO(nextReviewDate);
    nextCard.scheduled_days = FSRS_MAX_INTERVAL_DAYS;
  }
  const intervalDays = intervalBetween(reviewedDate, nextReviewDate);
  const successful = normalizedRating === "good" || normalizedRating === "easy";

  return {
    nextReviewDate,
    state: {
      ...state,
      status: "active",
      reviewKind: "memory",
      scheduler: FSRS_REVIEW_SCHEDULER,
      repetition: nextCard.reps,
      intervalDays,
      nextReviewDate,
      lastReviewDate: reviewedDate,
      lastReviewedAt: reviewedAt,
      consecutiveRemembered: successful ? state.consecutiveRemembered + 1 : 0,
      totalReviews: state.totalReviews + 1,
      fsrsCard: serializeFsrsCard(nextCard),
    },
  };
};

export const applyRecordReview = (
  state: RecordReviewState,
  rating: RecordReviewRating,
  reviewedDate: ISODate,
  reviewedAt: ISODateTime,
): ReviewScheduleResult =>
  reviewKindForState(state) === "memory"
    ? applyFsrsReview(state, rating, reviewedDate, reviewedAt)
    : applyOverviewReview(state, rating, reviewedDate, reviewedAt);

export const previewReviewRatings = (
  state: RecordReviewState,
  reviewedDate: ISODate,
): ReviewRatingPreview[] =>
  ACTIVE_REVIEW_RATINGS.map((rating) => {
    const reviewedAt = `${reviewedDate}T00:00:00.000Z`;
    const scheduled = reviewKindForState(state) === "memory"
      ? applyFsrsReview({ ...state }, rating, reviewedDate, reviewedAt)
      : applyOverviewReview({ ...state }, rating, reviewedDate, reviewedAt);
    return {
      rating,
      intervalDays: scheduled.state.intervalDays,
      nextReviewDate: scheduled.nextReviewDate ?? addDaysISO(reviewedDate, scheduled.state.intervalDays),
    };
  });

export const applySm2Review = applyOverviewReview;
