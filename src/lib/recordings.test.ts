import { describe, expect, it } from "vitest";

import type { Asset, RecordBlock, SubjectConfig } from "../types";
import { getRecordingFolders, searchRecordingItems } from "./recordings";

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

    expect(folders.map((folder) => folder.subject)).toEqual(["OS", "数学"]);
    expect(folders[0].items[0]).toMatchObject({
      assetId: "audio-1",
      subject: "OS",
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

    expect(folders.map((folder) => folder.subject)).toEqual(["OS", "数学", "CS"]);
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
});
