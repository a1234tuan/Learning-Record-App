import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StreamableBackupSnapshot } from "../types";
import {
  appendNativeAutoBackupZipEntry,
  beginNativeAutoBackupZipEntry,
  cancelNativeAutoBackupZip,
  finishNativeAutoBackupZip,
} from "./nativeAutoBackup";
import { writeNativeAutoBackupStreamSnapshot } from "./nativeAutoBackupStreamService";

vi.mock("./nativeAutoBackup", () => ({
  appendNativeAutoBackupZipEntry: vi.fn(),
  beginNativeAutoBackupZip: vi.fn(async () => ({ sessionId: "auto-1", folderName: "backup" })),
  beginNativeAutoBackupZipEntry: vi.fn(),
  cancelNativeAutoBackupZip: vi.fn(async () => undefined),
  canUseNativeAutoBackup: vi.fn(() => true),
  finishNativeAutoBackupZip: vi.fn(async () => ({ uri: "content://backup/latest.zip", folderName: "backup", size: 1 })),
  finishNativeAutoBackupZipEntry: vi.fn(),
}));

const decodeTextEntry = (data: string): string => decodeURIComponent(escape(atob(data)));

const stamp = "2026-06-21T00:00:00.000Z";

const snapshot: StreamableBackupSnapshot = {
  payload: {
    manifest: {
      format: "study-journal",
      version: 4,
      exportedAt: stamp,
      appVersion: "0.1.0",
      counts: {
        entries: 1,
        blocks: 1,
        mistakes: 0,
        assets: 0,
        tags: 0,
        reviews: 0,
        studySessions: 0,
      },
    },
    entries: [
      {
        id: "e1",
        createdAt: stamp,
        updatedAt: stamp,
        date: "2026-06-21",
        title: "2026-06-21",
        tags: [],
        pinned: false,
        favorite: false,
      },
    ],
    blocks: [
      {
        id: "r1",
        createdAt: stamp,
        updatedAt: stamp,
        type: "record",
        date: "2026-06-21",
        order: 0,
        subject: "数据结构",
        title: "结构内容",
        contentHtml: "<p>正文内容</p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
      },
    ],
    recordDrafts: [],
    mistakes: [],
    tags: [],
    reviews: [],
    recordReviews: [],
    recordReviewLogs: [],
    recordReviewDayStats: [],
    studySessions: [],
    settings: {
      id: "settings",
      examDate: "2026-12-27",
      theme: "system",
      accentColor: "#2f6f5e",
      backupReminderDays: 7,
      fontScale: 1,
      lineHeight: 1.7,
      schemaVersion: 4,
    },
  },
  assets: [],
  recordDrafts: [],
};

describe("native auto backup stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the full backup zip structure into the dedicated auto backup session", async () => {
    const writtenEntries = new Map<string, string>();
    let currentPath = "";
    vi.mocked(beginNativeAutoBackupZipEntry).mockImplementation(async (_sessionId, path) => {
      currentPath = path;
    });
    vi.mocked(appendNativeAutoBackupZipEntry).mockImplementation(async (_sessionId, data) => {
      writtenEntries.set(currentPath, `${writtenEntries.get(currentPath) ?? ""}${decodeTextEntry(data)}`);
    });

    const result = await writeNativeAutoBackupStreamSnapshot(snapshot, vi.fn());

    expect(result.size).toBe(1);
    expect(writtenEntries.get("manifest.json")).toContain("\"format\": \"study-journal\"");
    expect(writtenEntries.get("data.json")).toContain("\"assets\": []");
    expect(writtenEntries.get("entries/2026-06-21.md")).toContain("正文内容");
  });

  it("cancels the dedicated session when native finish returns an empty file", async () => {
    vi.mocked(finishNativeAutoBackupZip).mockResolvedValueOnce({
      uri: "content://backup/latest.zip",
      folderName: "backup",
      size: 0,
    });

    await expect(writeNativeAutoBackupStreamSnapshot(snapshot, vi.fn())).rejects.toThrow("自动备份写入结果为空");

    expect(cancelNativeAutoBackupZip).toHaveBeenCalledWith("auto-1");
  });
});
