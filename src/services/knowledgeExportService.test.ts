import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import type { Asset, StorageSnapshot } from "../types";
import {
  createKnowledgeJsonPayload,
  createPlainText,
  createSubjectMarkdownZip,
} from "./knowledgeExportService";
import { snapshotToZip, zipToSnapshot } from "./backup";

const stamp = "2026-06-21T00:00:00.000Z";

const imageAsset: Asset = {
  id: "a1",
  createdAt: stamp,
  updatedAt: stamp,
  fileName: "tree.png",
  title: "树截图",
  mimeType: "image/png",
  size: 4,
  kind: "image",
  data: new Blob(["tree"], { type: "image/png" }),
  ocrStatus: "done",
  ocrText: "二叉树遍历 OCR 文本",
};

const snapshot: StorageSnapshot = {
  payload: {
    manifest: {
      format: "study-journal",
      version: 3,
      exportedAt: stamp,
      appVersion: "0.1.0",
      counts: {
        entries: 1,
        blocks: 2,
        mistakes: 0,
        assets: 1,
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
        title: "树",
        contentHtml: "<h2>遍历</h2><p>先序和后序</p>",
        assets: [{ id: "a1", title: "树截图", kind: "image" }],
        formulas: [{ id: "f1", title: "复杂度", latex: "T(n)=O(n)" }],
        mistakeRefs: [],
      },
      {
        id: "r2",
        createdAt: stamp,
        updatedAt: stamp,
        type: "record",
        date: "2026-06-20",
        order: 0,
        subject: "OS",
        title: "进程",
        contentHtml: "<p>同步互斥</p>",
        assets: [],
        formulas: [],
        mistakeRefs: [],
      },
    ],
    mistakes: [],
    tags: [],
    reviews: [],
    studySessions: [],
    settings: {
      id: "settings",
      examDate: "2026-12-27",
      theme: "system",
      accentColor: "#2f6f5e",
      backupReminderDays: 7,
      fontScale: 1,
      lineHeight: 1.7,
      schemaVersion: 3,
    },
  },
  assets: [imageAsset],
};

describe("knowledge export", () => {
  it("creates subject markdown files sorted by subject", async () => {
    const zip = await JSZip.loadAsync(await createSubjectMarkdownZip(snapshot));
    const dataStructure = await zip.file("subjects/数据结构.md")?.async("string");
    const os = await zip.file("subjects/OS.md")?.async("string");

    expect(dataStructure).toContain("# 数据结构");
    expect(dataStructure).toContain("## 2026-06-21 树");
    expect(dataStructure).toContain("二叉树遍历 OCR 文本");
    expect(os).toContain("## 2026-06-20 进程");
  });

  it("exports JSON records with formulas, assets and OCR text", () => {
    const payload = createKnowledgeJsonPayload(snapshot);

    expect(payload.records[0]).toMatchObject({
      id: "r1",
      subject: "数据结构",
      formulas: ["T(n)=O(n)"],
      ocrTexts: ["二叉树遍历 OCR 文本"],
    });
    expect(payload.records[0].contentText).toContain("遍历");
    expect(payload.records[0].contentText).toContain("树截图");
    expect(payload.records[0].contentText).toContain("二叉树遍历 OCR 文本");
    expect(payload.records[0].assetTexts[0]).toContain("tree.png");
  });

  it("exports readable plain text", () => {
    const text = createPlainText(snapshot);

    expect(text).toContain("学习日志知识库");
    expect(text).toContain("2026-06-21｜数据结构｜树");
    expect(text).toContain("图片文字");
  });

  it("round-trips full backup assets and OCR metadata", async () => {
    const backup = await snapshotToZip(snapshot);
    const restored = await zipToSnapshot(new File([backup], "backup.zip", { type: "application/zip" }));

    expect(restored.assets[0]).toMatchObject({
      id: "a1",
      fileName: "tree.png",
      size: 4,
      ocrStatus: "done",
      ocrText: "二叉树遍历 OCR 文本",
    });
  });

  it("rejects non-zip restore files with a clear message", async () => {
    await expect(
      zipToSnapshot(new File(["# notes"], "notes.md", { type: "text/markdown" })),
    ).rejects.toThrow("只支持导入完整备份 zip 文件");
  });
});
