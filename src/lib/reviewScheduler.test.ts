import { describe, expect, it } from "vitest";

import type { RecordReviewRating, RecordReviewState } from "../types";
import {
  applyFsrsReview,
  applyOverviewReview,
  isReviewDueOn,
  normalizeLegacyRating,
  previewReviewRatings,
} from "./reviewScheduler";

const state = (patch: Partial<RecordReviewState> = {}): RecordReviewState => ({
  id: "record-1",
  recordId: "record-1",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  status: "active",
  reviewKind: "overview",
  scheduler: "overview-v1",
  easeFactor: 2.5,
  repetition: 0,
  intervalDays: 1,
  nextReviewDate: "2026-06-02",
  consecutiveRemembered: 0,
  totalReviews: 0,
  ...patch,
});

describe("reviewScheduler", () => {
  it("uses relaxed overview intervals for four ratings", () => {
    const forgot = applyOverviewReview(state({ intervalDays: 10 }), "forgot", "2026-06-02", "2026-06-02T08:00:00.000Z").state;
    expect(forgot.intervalDays).toBe(1);
    expect(forgot.nextReviewDate).toBe("2026-06-03");

    const fuzzy = applyOverviewReview(state({ intervalDays: 6 }), "fuzzy", "2026-06-09", "2026-06-09T08:00:00.000Z").state;
    expect(fuzzy.intervalDays).toBe(7);
    // Due date carries a deterministic +/-N day fuzz on top of the exact 7-day ladder step
    // (see the "spreads same-rating cards" test below for the mechanism).
    expect(fuzzy.nextReviewDate).toBe("2026-06-17");

    const good = applyOverviewReview(state({ intervalDays: 1 }), "good", "2026-06-02", "2026-06-02T08:00:00.000Z").state;
    expect(good.intervalDays).toBe(10);
    // Fuzzed landing date on top of the exact 10-day ladder step.
    expect(good.nextReviewDate).toBe("2026-06-13");

    const easy = applyOverviewReview(state({ intervalDays: 1 }), "easy", "2026-06-02", "2026-06-02T08:00:00.000Z").state;
    expect(easy.intervalDays).toBe(21);
    // Fuzzed landing date on top of the exact 21-day ladder step.
    expect(easy.nextReviewDate).toBe("2026-06-25");
  });

  it("advances overview good and easy ladders without repeating the same step", () => {
    const runSequence = (rating: RecordReviewRating, count: number) => {
      let current = state();
      let reviewedDate = "2026-06-02";
      const intervals: number[] = [];
      for (let index = 0; index < count; index += 1) {
        current = applyOverviewReview(current, rating, reviewedDate, `${reviewedDate}T08:00:00.000Z`).state;
        intervals.push(current.intervalDays);
        reviewedDate = current.nextReviewDate ?? reviewedDate;
      }
      return { current, intervals };
    };

    const good = runSequence("good", 5);
    expect(good.intervals).toEqual([10, 21, 45, 90, 180]);
    expect(good.current.status).toBe("active");

    const easy = runSequence("easy", 4);
    expect(easy.intervals).toEqual([21, 60, 120, 365]);
  });

  it("keeps overview rating previews strictly increasing at every interval boundary", () => {
    const cases = [
      [4, [1, 4, 10, 21]],
      [5, [1, 7, 10, 21]],
      [7, [1, 7, 10, 21]],
      [8, [1, 14, 21, 60]],
      [10, [1, 14, 21, 60]],
      [21, [1, 14, 45, 60]],
      [22, [1, 21, 45, 60]],
      [45, [1, 21, 90, 120]],
      [90, [1, 21, 180, 365]],
      [180, [1, 21, 180, 365]],
    ] as const;

    for (const [intervalDays, expectedIntervals] of cases) {
      const current = state({ intervalDays });
      const previews = previewReviewRatings(current, "2026-07-05");
      const previewIntervals = previews.map((preview) => preview.intervalDays);

      expect(previewIntervals).toEqual(expectedIntervals);
      expect(previewIntervals.every((interval, index) => index === 0 || previewIntervals[index - 1] < interval)).toBe(true);

      for (const preview of previews) {
        const scheduled = applyOverviewReview(current, preview.rating, "2026-07-05", "2026-07-05T08:00:00.000Z");
        expect(scheduled.state.intervalDays).toBe(preview.intervalDays);
        expect(scheduled.nextReviewDate).toBe(preview.nextReviewDate);
      }
    }
  });

  it("keeps the overview due-date fuzz deterministic for the same card and rating", () => {
    const first = applyOverviewReview(state({ intervalDays: 1 }), "good", "2026-06-02", "2026-06-02T08:00:00.000Z");
    const second = applyOverviewReview(state({ intervalDays: 1 }), "good", "2026-06-02", "2026-06-02T08:00:00.000Z");
    expect(second.nextReviewDate).toBe(first.nextReviewDate);
    expect(second.state.intervalDays).toBe(first.state.intervalDays);
  });

  it("spreads the overview due-date fuzz across different cards given the same rating", () => {
    const dates = new Set(
      Array.from({ length: 12 }, (_, index) =>
        applyOverviewReview(state({ id: `record-${index}`, recordId: `record-${index}`, intervalDays: 1 }), "good", "2026-06-02", "2026-06-02T08:00:00.000Z").nextReviewDate,
      ),
    );
    // A batch of cards rated "good" together should not all land on the exact same day.
    expect(dates.size).toBeGreaterThan(1);
  });

  it("never fuzzes the one-day forgot interval earlier than tomorrow", () => {
    for (let index = 0; index < 12; index += 1) {
      const next = applyOverviewReview(
        state({ id: `record-${index}`, recordId: `record-${index}`, intervalDays: 30 }),
        "forgot",
        "2026-06-02",
        "2026-06-02T08:00:00.000Z",
      );
      expect(next.state.intervalDays).toBe(1);
      expect(next.nextReviewDate).toBe("2026-06-03");
    }
  });

  it("compresses fuzzy overview reviews instead of expanding them to the old 15 day result", () => {
    const next = applyOverviewReview(
      state({ repetition: 2, intervalDays: 15, consecutiveRemembered: 2 }),
      "fuzzy",
      "2026-07-05",
      "2026-07-05T08:00:00.000Z",
    ).state;

    expect(next.intervalDays).toBe(14);
    // Fuzzed landing date on top of the exact 14-day ladder step.
    expect(next.nextReviewDate).toBe("2026-07-16");
    expect(next.consecutiveRemembered).toBe(0);
  });

  it("does not automatically master cards after five successful overview ratings", () => {
    const next = applyOverviewReview(
      state({ repetition: 4, intervalDays: 20, consecutiveRemembered: 4 }),
      "good",
      "2026-06-20",
      "2026-06-20T08:00:00.000Z",
    ).state;

    expect(next.status).toBe("active");
    // Fuzzed landing date on top of the exact 21-day ladder step.
    expect(next.nextReviewDate).toBe("2026-07-06");
    expect(next.consecutiveRemembered).toBe(5);
  });

  it("applies FSRS scheduling for memory cards and keeps dates at least tomorrow", () => {
    const memory = state({ reviewKind: "memory", scheduler: "fsrs-v6" });
    const previews = previewReviewRatings(memory, "2026-07-05");
    expect(previews.map((preview) => preview.rating)).toEqual(["forgot", "fuzzy", "good", "easy"]);
    expect(previews.every((preview) => preview.nextReviewDate > "2026-07-05")).toBe(true);
    expect(previews.map((preview) => preview.intervalDays)).toEqual([...previews.map((preview) => preview.intervalDays)].sort((a, b) => a - b));

    const next = applyFsrsReview(memory, "good", "2026-07-05", "2026-07-05T08:00:00.000Z").state;
    expect(next.reviewKind).toBe("memory");
    expect(next.scheduler).toBe("fsrs-v6");
    expect(next.fsrsCard).toBeDefined();
    expect(Boolean(next.nextReviewDate && next.nextReviewDate > "2026-07-05")).toBe(true);
  });

  it("caps FSRS growth and handles rollback dates without invalid elapsed days", () => {
    let current = state({ reviewKind: "memory", scheduler: "fsrs-v6" });
    const first = applyFsrsReview(current, "good", "2026-07-05", "2026-07-05T08:00:00.000Z").state;
    const rollback = applyFsrsReview(first, "good", "2026-07-04", "2026-07-04T08:00:00.000Z").state;
    expect(rollback.fsrsCard?.elapsedDays).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(rollback.fsrsCard?.stability)).toBe(true);
    expect(Number.isFinite(rollback.fsrsCard?.difficulty)).toBe(true);

    let reviewedDate = "2026-07-05";
    for (let index = 0; index < 10; index += 1) {
      current = applyFsrsReview(current, "good", reviewedDate, `${reviewedDate}T08:00:00.000Z`).state;
      expect(current.intervalDays).toBeLessThanOrEqual(365);
      reviewedDate = current.nextReviewDate ?? reviewedDate;
    }
  });

  it("keeps FSRS state finite after repeated again ratings", () => {
    let current = state({ reviewKind: "memory", scheduler: "fsrs-v6" });
    let reviewedDate = "2026-07-05";
    for (let index = 0; index < 20; index += 1) {
      current = applyFsrsReview(current, "forgot", reviewedDate, `${reviewedDate}T08:00:00.000Z`).state;
      reviewedDate = current.nextReviewDate ?? reviewedDate;
    }

    expect(Number.isFinite(current.fsrsCard?.stability)).toBe(true);
    expect(Number.isFinite(current.fsrsCard?.difficulty)).toBe(true);
  });

  it("previews the same dates that real rating will persist", () => {
    const memory = applyFsrsReview(
      state({ reviewKind: "memory", scheduler: "fsrs-v6" }),
      "good",
      "2026-07-05",
      "2026-07-05T08:00:00.000Z",
    ).state;
    const reviewedDate = memory.nextReviewDate ?? "2026-07-08";
    const previews = previewReviewRatings(memory, reviewedDate);

    for (const preview of previews) {
      const real = applyFsrsReview(memory, preview.rating, reviewedDate, `${reviewedDate}T08:00:00.000Z`).state;
      expect(preview.intervalDays).toBe(real.intervalDays);
      expect(preview.nextReviewDate).toBe(real.nextReviewDate);
    }
  });

  it("normalizes legacy remembered ratings to good", () => {
    expect(normalizeLegacyRating("remembered")).toBe("good");
  });

  it("treats cards reviewed today as no longer due even if the due date is stale", () => {
    expect(isReviewDueOn(state({ nextReviewDate: "2026-07-02" }), "2026-07-03")).toBe(true);
    expect(isReviewDueOn(state({ nextReviewDate: "2026-07-02", lastReviewDate: "2026-07-03" }), "2026-07-03")).toBe(false);
    expect(isReviewDueOn(state({ status: "mastered", nextReviewDate: undefined }), "2026-07-03")).toBe(false);
  });
});
