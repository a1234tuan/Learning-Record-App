import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PAGE_TRANSITION_DURATION_MS, PageTransition } from "./PageTransition";

describe("PageTransition", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the previous page mounted while the next page enters", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <PageTransition pageKey="today">
        <main>今天</main>
      </PageTransition>,
    );

    rerender(
      <PageTransition pageKey="journal">
        <main>日志</main>
      </PageTransition>,
    );

    expect(screen.getByText("今天")).toBeInTheDocument();
    expect(screen.getByText("日志")).toBeInTheDocument();
    expect(screen.getByText("今天").parentElement).toHaveAttribute("aria-hidden", "true");

    act(() => {
      vi.advanceTimersByTime(PAGE_TRANSITION_DURATION_MS);
    });

    expect(screen.queryByText("今天")).not.toBeInTheDocument();
    expect(screen.getByText("日志")).toBeInTheDocument();
  });

  it("drops stale exiting pages during rapid navigation", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <PageTransition pageKey="today">
        <main>今天</main>
      </PageTransition>,
    );

    rerender(
      <PageTransition pageKey="journal">
        <main>日志</main>
      </PageTransition>,
    );
    rerender(
      <PageTransition pageKey="recordings">
        <main>录音</main>
      </PageTransition>,
    );

    expect(screen.queryByText("今天")).not.toBeInTheDocument();
    expect(screen.getByText("日志")).toBeInTheDocument();
    expect(screen.getByText("录音")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(PAGE_TRANSITION_DURATION_MS);
    });

    expect(screen.queryByText("日志")).not.toBeInTheDocument();
    expect(screen.getByText("录音")).toBeInTheDocument();
  });

  it("updates content in place when the page key does not change", () => {
    const { rerender } = render(
      <PageTransition pageKey="journal">
        <main>日志列表</main>
      </PageTransition>,
    );

    rerender(
      <PageTransition pageKey="journal">
        <main>筛选后的日志列表</main>
      </PageTransition>,
    );

    expect(screen.queryByText("日志列表")).not.toBeInTheDocument();
    expect(screen.getByText("筛选后的日志列表")).toBeInTheDocument();
  });
});
