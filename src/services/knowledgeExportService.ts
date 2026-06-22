import JSZip from "jszip";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { saveAs } from "file-saver";

import type {
  Asset,
  ExportKind,
  KnowledgeExportPayload,
  KnowledgeRecord,
  RecordBlock,
  StorageSnapshot,
} from "../types";
import { getAllVisibleSubjects } from "../lib/subjects";
import { blobToBase64, snapshotToZip } from "./backup";
import { isNativePlatform } from "../lib/platform";
import { sanitizeFileName } from "./assetDownloadService";
import { parseLinearRecordContent, recordToPlainText } from "../lib/recordContent";

const assetLabel = (asset: Asset | undefined, fallbackTitle: string): string => {
  if (!asset) {
    return fallbackTitle;
  }
  return [fallbackTitle, asset.title, asset.fileName].filter(Boolean).join(" / ");
};

const getRecords = (snapshot: StorageSnapshot): RecordBlock[] =>
  snapshot.payload.blocks
    .filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt)
    .sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order);

const getAssetMap = (snapshot: StorageSnapshot): Map<string, Asset> =>
  new Map(snapshot.assets.map((asset) => [asset.id, asset]));

export const createKnowledgeRecords = (snapshot: StorageSnapshot): KnowledgeRecord[] => {
  const assets = getAssetMap(snapshot);
  return getRecords(snapshot).map((record) => {
    const nodes = parseLinearRecordContent(record, Array.from(assets.values()));

    return {
      id: record.id,
      date: record.date,
      subject: record.subject,
      title: record.title,
      contentText: recordToPlainText(record, Array.from(assets.values())),
      formulas: nodes
        .filter((node) => node.kind === "formula")
        .map((node) => node.formula.latex),
      assetTexts: nodes
        .filter((node) => node.kind === "asset")
        .map((node) => assetLabel(node.asset, node.ref.title)),
      ocrTexts: nodes
        .filter((node) => node.kind === "asset")
        .map((node) => node.asset?.ocrText?.trim() ?? "")
        .filter(Boolean),
      updatedAt: record.updatedAt,
    };
  });
};

export const createKnowledgeJsonPayload = (snapshot: StorageSnapshot): KnowledgeExportPayload => ({
  format: "study-journal-knowledge",
  version: 1,
  exportedAt: snapshot.payload.manifest.exportedAt,
  records: createKnowledgeRecords(snapshot),
});

const recordToMarkdown = (record: KnowledgeRecord): string => {
  const sections = [
    `## ${record.date} ${record.title}`,
    "",
    `- 学科：${record.subject}`,
    `- 更新时间：${record.updatedAt}`,
    "",
    record.contentText,
  ];

  if (record.formulas.length > 0) {
    sections.push("", "### 公式", ...record.formulas.map((formula) => `\n$$\n${formula}\n$$`));
  }
  if (record.assetTexts.length > 0) {
    sections.push("", "### 资源", ...record.assetTexts.map((asset) => `- ${asset}`));
  }
  if (record.ocrTexts.length > 0) {
    sections.push("", "### 图片 OCR", ...record.ocrTexts.map((text) => `\n${text}`));
  }

  return sections.join("\n").trim();
};

const subjectMarkdown = (subject: string, records: KnowledgeRecord[]): string => {
  const body = records.filter((record) => record.subject === subject).map(recordToMarkdown);
  return [`# ${subject}`, "", body.length > 0 ? body.join("\n\n---\n\n") : "暂无记录", ""].join("\n");
};

export const createSubjectMarkdownZip = async (snapshot: StorageSnapshot): Promise<Blob> => {
  const records = createKnowledgeRecords(snapshot);
  const zip = new JSZip();
  const folder = zip.folder("subjects");
  const recordBlocks = getRecords(snapshot);
  const subjects = getAllVisibleSubjects(snapshot.payload.settings, recordBlocks);
  for (const subject of subjects) {
    folder?.file(`${sanitizeFileName(subject.name)}.md`, subjectMarkdown(subject.name, records));
  }
  return zip.generateAsync({ type: "blob" });
};

export const createPlainText = (snapshot: StorageSnapshot): string => {
  const records = createKnowledgeRecords(snapshot);
  return [
    "学习日志知识库",
    `导出时间：${snapshot.payload.manifest.exportedAt}`,
    "",
    ...records.map((record) =>
      [
        `${record.date}｜${record.subject}｜${record.title}`,
        record.contentText,
        record.formulas.length > 0 ? `公式：\n${record.formulas.join("\n\n")}` : "",
        record.assetTexts.length > 0 ? `资源：${record.assetTexts.join("；")}` : "",
        record.ocrTexts.length > 0 ? `图片文字：\n${record.ocrTexts.join("\n\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    "",
  ].join("\n\n---\n\n");
};

const writeOrDownload = async (blob: Blob, fileName: string, title: string): Promise<string> => {
  const safeName = sanitizeFileName(fileName);
  if (!isNativePlatform()) {
    saveAs(blob, safeName);
    return "已开始下载。";
  }

  const base64 = await blobToBase64(blob);
  const writeResult = await Filesystem.writeFile({
    path: safeName,
    data: base64,
    directory: Directory.Documents,
    recursive: true,
  });

  await Share.share({
    title,
    text: title,
    files: [writeResult.uri],
    dialogTitle: "保存或分享导出文件",
  });

  return "已打开系统保存/分享面板。";
};

export const exportFullBackup = async (snapshot: StorageSnapshot): Promise<string> => {
  const date = snapshot.payload.manifest.exportedAt.slice(0, 10);
  const zip = await snapshotToZip(snapshot);
  return writeOrDownload(zip, `study-journal-${date}.zip`, "学习日志完整备份");
};

export const exportSubjectMarkdown = async (snapshot: StorageSnapshot): Promise<string> => {
  const date = snapshot.payload.manifest.exportedAt.slice(0, 10);
  const zip = await createSubjectMarkdownZip(snapshot);
  return writeOrDownload(zip, `study-journal-subjects-${date}.zip`, "学习日志学科 Markdown");
};

export const exportKnowledgeJson = async (snapshot: StorageSnapshot): Promise<string> => {
  const date = snapshot.payload.manifest.exportedAt.slice(0, 10);
  const blob = new Blob([JSON.stringify(createKnowledgeJsonPayload(snapshot), null, 2)], {
    type: "application/json;charset=utf-8",
  });
  return writeOrDownload(blob, `study-journal-knowledge-${date}.json`, "学习日志知识库 JSON");
};

export const exportPlainText = async (snapshot: StorageSnapshot): Promise<string> => {
  const date = snapshot.payload.manifest.exportedAt.slice(0, 10);
  const blob = new Blob([createPlainText(snapshot)], { type: "text/plain;charset=utf-8" });
  return writeOrDownload(blob, `study-journal-knowledge-${date}.txt`, "学习日志纯文本");
};

export const exportKnowledge = async (kind: ExportKind, snapshot: StorageSnapshot): Promise<string> => {
  switch (kind) {
    case "full-backup":
      return exportFullBackup(snapshot);
    case "subject-markdown":
      return exportSubjectMarkdown(snapshot);
    case "knowledge-json":
      return exportKnowledgeJson(snapshot);
    case "plain-text":
      return exportPlainText(snapshot);
  }
};
