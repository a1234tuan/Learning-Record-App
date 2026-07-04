import { describe, expect, it } from "vitest";

import { DAILY_MOTTOS, getDailyMotto } from "./dailyMotto";

describe("daily motto", () => {
  it("keeps the same motto stable for a date", () => {
    expect(getDailyMotto("2026-07-04")).toBe(getDailyMotto("2026-07-04"));
    expect(DAILY_MOTTOS).toContain(getDailyMotto("2026-07-04"));
  });

  it("can rotate the motto across dates", () => {
    expect(getDailyMotto("2026-07-04")).not.toBe(getDailyMotto("2026-07-05"));
  });
});
