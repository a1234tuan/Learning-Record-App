import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgePodcast, RecordBlock } from "../types";
import { KnowledgePodcastPage } from "./KnowledgePodcastPage";

const podcast: KnowledgePodcast = {
  id: "podcast-1",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  title: "本周复习",
  mode: "explain",
  targetMinutes: 5,
  scope: { kind: "recent", days: 7 },
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
  it("renders the mobile-safe two-row player control structure", () => {
    const { container } = render(<KnowledgePodcastPage {...props} />);
    expect(container.querySelector(".podcast-player-actions")?.children).toHaveLength(4);
    expect(container.querySelector(".podcast-player-options")).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
    expect(screen.getByDisplayValue("voice-id-that-must-wrap-on-mobile")).toBeInTheDocument();
  });

  it("uses the shared scope picker for podcast date, tag, recent and record scopes", () => {
    render(<KnowledgePodcastPage {...props} screen="scope" />);
    expect(screen.getByRole("main", { name: "选择播客知识范围" })).toHaveClass("ai-scope-page");
    expect(screen.getByRole("tab", { name: "学科标签" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "近期学习" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "按日期" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "选择日志" })).toBeInTheDocument();
  });

  it("marks legacy podcast audio as requiring a full regeneration and does not render its old player", () => {
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
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});
