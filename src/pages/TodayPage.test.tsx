import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodayPage } from "./TodayPage";
import type { SubjectConfig } from "../types";
import { getDailyMotto } from "../lib/dailyMotto";

const stamp = "2026-06-21T00:00:00.000Z";

const subjects: SubjectConfig[] = [
  {
    id: "subject-math",
    createdAt: stamp,
    updatedAt: stamp,
    name: "数学",
    order: 0,
  },
];

const renderPage = (onOpenFavorites = vi.fn()) => render(
  <TodayPage
    entry={null}
    blocks={[]}
    examDate="2026-12-27"
    subjects={subjects}
    onSaveEntry={vi.fn()}
    onCreateRecord={vi.fn()}
    onOpenFavorites={onOpenFavorites}
    onOpenRecord={vi.fn()}
    onToggleFavorite={vi.fn()}
  />,
);

afterEach(() => {
  vi.useRealTimers();
});

describe("TodayPage", () => {
  it("keeps subject creation out of the home new-record panel", () => {
    renderPage();

    expect(screen.queryByLabelText("新增学科")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新建 .* 记录/ })).toBeInTheDocument();
    expect(screen.getByText("更多学科可到“分类 / 学科管理”中新建。")).toBeInTheDocument();
  });

  it("shows a stable daily motto in the page header", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T09:00:00+08:00"));
    renderPage();

    expect(screen.getByText(getDailyMotto("2026-07-04"))).toBeInTheDocument();
  });

  it("opens favorites from the compact header action", () => {
    const onOpenFavorites = vi.fn();
    renderPage(onOpenFavorites);

    fireEvent.click(screen.getByRole("button", { name: "打开收藏夹" }));

    expect(onOpenFavorites).toHaveBeenCalledTimes(1);
  });
});
