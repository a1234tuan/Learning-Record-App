import { describe, expect, it } from "vitest";

import type { RecordReviewState } from "../types";
import { applySm2Review, isReviewDueOn } from "./reviewScheduler";

const state = (patch: Partial<RecordReviewState> = {}): RecordReviewState => ({
  id: "record-1",
  recordId: "record-1",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  status: "active",
  easeFactor: 2.5,
  repetition: 0,
  intervalDays: 1,
  nextReviewDate: "2026-06-02",
  consecutiveRemembered: 0,
  totalReviews: 0,
  ...patch,
});

describe("reviewScheduler", () => {
  it("uses strict SM-2 intervals for remembered reviews", () => {
    const first = applySm2Review(state(), "remembered", "2026-06-02", "2026-06-02T08:00:00.000Z").state;
    expect(first.repetition).toBe(1);
    expect(first.intervalDays).toBe(1);
    expect(first.nextReviewDate).toBe("2026-06-03");

    const second = applySm2Review(first, "remembered", "2026-06-03", "2026-06-03T08:00:00.000Z").state;
    expect(second.repetition).toBe(2);
    expect(second.intervalDays).toBe(6);
    expect(second.nextReviewDate).toBe("2026-06-09");
  });

  it("keeps repetition but resets consecutive remembered count for fuzzy reviews", () => {
    const next = applySm2Review(
      state({ repetition: 2, intervalDays: 6, consecutiveRemembered: 2 }),
      "fuzzy",
      "2026-06-09",
      "2026-06-09T08:00:00.000Z",
    ).state;

    expect(next.repetition).toBe(3);
    expect(next.consecutiveRemembered).toBe(0);
    expect(next.easeFactor).toBeLessThan(2.5);
  });

  it("resets repetition after forgotten reviews", () => {
    const next = applySm2Review(
      state({ repetition: 3, intervalDays: 15, consecutiveRemembered: 3 }),
      "forgot",
      "2026-06-10",
      "2026-06-10T08:00:00.000Z",
    ).state;

    expect(next.repetition).toBe(0);
    expect(next.intervalDays).toBe(1);
    expect(next.nextReviewDate).toBe("2026-06-11");
    expect(next.consecutiveRemembered).toBe(0);
  });

  it("marks a record mastered after five consecutive remembered reviews", () => {
    const next = applySm2Review(
      state({ repetition: 4, intervalDays: 20, consecutiveRemembered: 4 }),
      "remembered",
      "2026-06-20",
      "2026-06-20T08:00:00.000Z",
    ).state;

    expect(next.status).toBe("mastered");
    expect(next.nextReviewDate).toBeUndefined();
    expect(next.consecutiveRemembered).toBe(5);
  });

  it("treats cards reviewed today as no longer due even if the due date is stale", () => {
    expect(isReviewDueOn(state({ nextReviewDate: "2026-07-02" }), "2026-07-03")).toBe(true);
    expect(isReviewDueOn(state({ nextReviewDate: "2026-07-02", lastReviewDate: "2026-07-03" }), "2026-07-03")).toBe(false);
    expect(isReviewDueOn(state({ status: "mastered", nextReviewDate: undefined }), "2026-07-03")).toBe(false);
  });
});
