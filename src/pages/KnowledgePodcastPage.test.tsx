import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgePodcast, RecordBlock } from "../types";
import { KnowledgePodcastPage } from "./KnowledgePodcastPage";

const podcast: KnowledgePodcast = {
  id: "podcast-1",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  title: "本周复习",
  mode: "explain",
  targetMinutes: 5,
  scope: { kind: "records", recordIds: ["record-1"] },
  sourceRecordIds: [],
  contextHash: "",
  scriptStatus: "ready",
  audioStatus: "idle",
  audioLayoutVersion: 2,
  audioUnits: [],
  segments: [],
  ttsConfig: { providerId: "fish-audio", model: "s2.1-pro-free", voiceId: "voice-id-that-must-wrap-on-mobile", format: "mp3" },
};

const record: RecordBlock = {
  id: "record-1",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  type: "record",
  date: "2026-08-03",
  order: 0,
  subject: "数据结构",
  title: "二叉树",
  contentHtml: "<p>遍历</p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
  tags: ["重点"],
};

const props = {
  podcasts: [podcast],
  blocks: [record],
  assets: [],
  podcastId: podcast.id,
  onBack: vi.fn(),
  onOpenScope: vi.fn(),
  onOpenPodcast: vi.fn(),
  onSavePodcast: vi.fn(async (next: KnowledgePodcast) => next),
  onDeletePodcast: vi.fn(async () => undefined),
  onOpenRecord: vi.fn(),
};

describe("KnowledgePodcastPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the mobile-safe two-row player control structure", () => {
    const { container } = render(<KnowledgePodcastPage {...props} />);
    expect(container.querySelector(".podcast-player-actions")?.children).toHaveLength(6);
    expect(container.querySelector(".podcast-player-options")).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "播放速度" })).toBeInTheDocument();
  });

  it("uses the shared scope picker for podcast date, tag, recent and record scopes", () => {
    render(<KnowledgePodcastPage {...props} screen="scope" />);
    expect(screen.getByRole("main", { name: "选择播客知识范围" })).toHaveClass("ai-scope-page");
    expect(screen.getByRole("tab", { name: "学科标签" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "近期学习" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "按日期" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "选择日志" })).toBeInTheDocument();
  });

  it("uses a compact settings band while keeping planner and scope controls available", () => {
    const { container } = render(<KnowledgePodcastPage {...props} />);
    const planner = container.querySelector<HTMLDetailsElement>("details.podcast-planner-card");

    expect(container.querySelector(".podcast-settings-band")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("本周复习");
    expect(screen.getByRole("combobox", { name: "模式" })).toHaveValue("explain");
    expect(screen.getByRole("combobox", { name: "目标时长" })).toHaveValue("5");
    expect(screen.getByText("节目策划")).toBeInTheDocument();
    expect(screen.getByText("复习讲解 · 使用模式推荐")).toBeInTheDocument();
    expect(screen.queryByText("Podcast Planner")).not.toBeInTheDocument();
    expect(planner).not.toBeNull();
    expect(planner).not.toHaveAttribute("open");

    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "期末复习" } });
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("期末复习");

    fireEvent.click(planner!.querySelector("summary")!);
    expect(planner).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "恢复模式推荐设置" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("像老师一样讲清重点、联系和易错点，并帮助复习")).toBeInTheDocument();
    expect(screen.getByText("查看本期生成指令预览")).toBeInTheDocument();
    expect(planner!.querySelectorAll(".podcast-planner-group")[1]).not.toHaveAttribute("open");

    expect(screen.getByText(/命中 1 条日志/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "修改知识范围" }));
    expect(props.onOpenScope).toHaveBeenCalledTimes(1);
  });

  it("marks legacy podcast audio as requiring a full regeneration while keeping the player area visible", () => {
    const legacy = {
      ...podcast,
      audioLayoutVersion: undefined,
      audioUnits: undefined,
      audioStatus: "ready" as const,
      segments: [{ id: "segment-1", order: 0, title: "章节", text: "正文", sourceRecordIds: [], textHash: "hash", audioAssetId: "legacy-audio", audioStatus: "ready" as const }],
    };
    render(<KnowledgePodcastPage {...props} podcasts={[legacy]} />);
    expect(screen.getByText(/音频格式已更新，需要重新生成整期音频/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新生成整期音频/ })).toBeInTheDocument();
    expect(document.querySelector(".podcast-player-card")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});
