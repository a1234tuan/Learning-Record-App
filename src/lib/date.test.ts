import { describe, expect, it } from "vitest";

import { addDaysISO, isoDateTimeToLocalDate } from "./date";

describe("date helpers", () => {
  it("derives review dates from local time instead of UTC date prefixes", () => {
    expect(isoDateTimeToLocalDate("2026-07-02T16:30:00.000Z")).toBe("2026-07-03");
    expect("2026-07-02T16:30:00.000Z".slice(0, 10)).toBe("2026-07-02");
  });

  it("keeps review next dates on ISO calendar days", () => {
    expect(addDaysISO("2026-07-03", 1)).toBe("2026-07-04");
  });
});
