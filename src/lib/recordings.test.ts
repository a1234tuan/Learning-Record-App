import { describe, expect, it } from "vitest";

import type { Asset, KnowledgePodcast, RecordBlock, SubjectConfig } from "../types";
import { getRecordingFolders, recordingFolderIdForPodcast, recordingFolderIdForSubject, searchRecordingItems } from "./recordings";

const stamp = "2026-06-21T00:00:00.000Z";

const audio = (id: string, title: string, fileName = `${id}.m4a`): Asset => ({
  id,
  createdAt: stamp,
  updatedAt: stamp,
  fileName,
  title,
  mimeType: "audio/mp4",
  size: 128,
  kind: "audio",
  data: new Blob(["audio"]),
});

const record = (patch: Partial<RecordBlock>): RecordBlock => ({
  id: "record-1",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject: "OS",
  tags: [],
  title: "进程同步",
  contentHtml: "<p></p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
  ...patch,
});

const subjects: SubjectConfig[] = [
  {
    id: "subject-os",
    createdAt: stamp,
    updatedAt: stamp,
    name: "OS",
    order: 0,
  },
  {
    id: "subject-math",
    createdAt: stamp,
    updatedAt: stamp,
    name: "数学",
    order: 1,
  },
];

const podcast = (): KnowledgePodcast => ({
  id: "podcast-1",
  createdAt: stamp,
  updatedAt: stamp,
  title: "本周数据结构复习",
  mode: "explain",
  targetMinutes: 5,
  scope: { kind: "recent", days: 7 },
  sourceRecordIds: [],
  contextHash: "",
  scriptStatus: "ready",
  audioStatus: "ready",
  audioLayoutVersion: 2,
  audioUnits: [{
    id: "unit-segment-1",
    kind: "segment",
    order: 0,
    title: "二叉树遍历",
    segmentId: "segment-1",
    textHash: "hash",
    audioAssetId: "podcast-audio-1",
    audioStatus: "ready",
  }],
  segments: [{
    id: "segment-1",
    order: 0,
    title: "二叉树遍历",
    text: "正文",
    sourceRecordIds: [],
    textHash: "hash",
    audioAssetId: "podcast-audio-1",
    audioStatus: "ready",
  }],
  ttsConfig: { providerId: "fish-audio", model: "s2.1-pro-free", voiceId: "voice", format: "mp3" },
});

describe("recordings", () => {
  it("groups referenced audio assets by visible subjects and keeps empty configured folders", () => {
    const folders = getRecordingFolders(
      [
        record({
          assets: [{ id: "audio-1", title: "课堂录音", kind: "audio" }],
        }),
      ],
      [audio("audio-1", "原始标题")],
      subjects,
    );

    expect(folders.map((folder) => folder.title)).toEqual(["OS", "数学"]);
    expect(folders[0].id).toBe(recordingFolderIdForSubject("OS"));
    expect(folders[0].items[0]).toMatchObject({
      assetId: "audio-1",
      folderTitle: "OS",
      recordTitle: "进程同步",
      title: "课堂录音",
    });
    expect(folders[1].items).toEqual([]);
  });

  it("adds archived or historical subjects only when they have recordings", () => {
    const folders = getRecordingFolders(
      [
        record({
          subject: "CS",
          assets: [{ id: "audio-1", title: "CS lecture", kind: "audio" }],
        }),
      ],
      [audio("audio-1", "CS lecture")],
      subjects,
    );

    expect(folders.map((folder) => folder.title)).toEqual(["OS", "数学", "CS"]);
  });

  it("searches recording titles and original file names", () => {
    const folders = getRecordingFolders(
      [
        record({
          assets: [{ id: "audio-1", title: "调度讲解", kind: "audio" }],
        }),
      ],
      [audio("audio-1", "asset title", "scheduler.m4a")],
      subjects,
    );

    expect(searchRecordingItems(folders, "调度")).toHaveLength(1);
    expect(searchRecordingItems(folders, "scheduler")).toHaveLength(1);
    expect(searchRecordingItems(folders, "进程同步")).toHaveLength(0);
  });

  it("places generated podcast chapters in one dedicated podcast folder", () => {
    const generated = { ...audio("audio-1", "播客章节"), generatedBy: "knowledge-podcast" as const };
    const folders = getRecordingFolders([], [{ ...generated, id: "podcast-audio-1" }], subjects, [podcast()]);

    expect(folders).toHaveLength(3);
    expect(folders[2]).toMatchObject({
      id: recordingFolderIdForPodcast("podcast-1"),
      title: "本周数据结构复习",
      kind: "knowledge-podcast",
    });
    expect(folders[2].items[0]).toMatchObject({
      assetId: "podcast-audio-1",
      title: "播客章节",
      folderKind: "knowledge-podcast",
    });
  });

  it("does not surface generated podcast audio outside its podcast folder", () => {
    const generated = { ...audio("audio-1", "播客章节"), generatedBy: "knowledge-podcast" as const };
    const folders = getRecordingFolders([record({ assets: [{ id: generated.id, title: generated.title ?? "", kind: "audio" }] })], [generated], subjects);
    expect(folders[0].items).toEqual([]);
  });

  it("orders opening, chapters and closing in a v2 podcast folder while excluding legacy audio", () => {
    const audioAssets = ["opening", "chapter", "closing"].map((id) => ({ ...audio(`asset-${id}`, id), generatedBy: "knowledge-podcast" as const }));
    const current = podcast();
    current.audioUnits = [
      { id: "opening", kind: "opening", order: 0, title: "开场", textHash: "o", audioAssetId: "asset-opening", audioStatus: "ready" },
      { id: "chapter", kind: "segment", order: 1, title: "二叉树遍历", segmentId: "segment-1", textHash: "s", audioAssetId: "asset-chapter", audioStatus: "ready" },
      { id: "closing", kind: "closing", order: 2, title: "结尾", textHash: "c", audioAssetId: "asset-closing", audioStatus: "ready" },
    ];
    const folders = getRecordingFolders([], audioAssets, subjects, [current]);
    expect(folders[2].items.map((item) => item.title)).toEqual(["opening", "chapter", "closing"]);

    const legacy = { ...current, audioLayoutVersion: undefined, audioUnits: undefined };
    expect(getRecordingFolders([], audioAssets, subjects, [legacy])).toHaveLength(2);
  });

  it("uses a renamed podcast asset title", () => {
    const generated = { ...audio("podcast-audio-1", "二叉树遍历"), generatedBy: "knowledge-podcast" as const };
    const folders = getRecordingFolders([], [generated], subjects, [podcast()]);
    expect(folders[2].items[0].title).toBe("二叉树遍历");

    const renamedFolders = getRecordingFolders([], [{ ...generated, title: "重点复习" }], subjects, [podcast()]);
    expect(renamedFolders[2].items[0].title).toBe("重点复习");
  });
});
