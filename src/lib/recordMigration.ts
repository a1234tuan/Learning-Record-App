import type { Block, RecordBlock, Subject } from "../types";
import { createBaseEntity } from "./entity";
import { normalizeSubject, nextRecordTitle } from "./subjects";
import { syncRecordRefsFromContent } from "./recordContent";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const titleFromBlock = (block: Block, subject: Subject, index: number): string => {
  if (block.type === "todo" && block.title) {
    return block.title;
  }
  if (block.type === "studySession") {
    return `${subject}学习时长`;
  }
  return nextRecordTitle(subject, index);
};

export const isRecordBlock = (block: Block): block is RecordBlock => block.type === "record";

export const migrateBlocksToRecords = (blocks: Block[]): Block[] => {
  const counters = new Map<string, number>();

  return blocks.flatMap((block) => {
    if (block.type === "mistakeRef") {
      return [];
    }

    if (block.type === "record") {
      return [syncRecordRefsFromContent({
        ...block,
        subject: normalizeSubject(block.subject),
        assets: block.assets ?? [],
        formulas: block.formulas ?? [],
        mistakeRefs: [],
      })];
    }

    const subject = block.type === "studySession" ? normalizeSubject(block.subject) : normalizeSubject();
    const key = `${block.date}:${subject}`;
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);

    const base: RecordBlock = {
      ...createBaseEntity(),
      id: block.id,
      createdAt: block.createdAt,
      updatedAt: block.updatedAt,
      deletedAt: block.deletedAt,
      type: "record",
      date: block.date,
      order: block.order,
      subject,
      title: titleFromBlock(block, subject, index),
      contentHtml: "<p></p>",
      assets: [],
      formulas: [],
      mistakeRefs: [],
    };

    switch (block.type) {
      case "richText":
        return [syncRecordRefsFromContent({ ...base, contentHtml: block.content || "<p></p>" })];
      case "image":
        return [syncRecordRefsFromContent({
          ...base,
          contentHtml: block.caption ? `<p>${escapeHtml(block.caption)}</p>` : "<p></p>",
          assets: [{ id: block.assetId, title: block.caption ?? "图片", kind: "image" }],
        })];
      case "attachment":
        return [syncRecordRefsFromContent({
          ...base,
          contentHtml: block.note ? `<p>${escapeHtml(block.note)}</p>` : "<p></p>",
          assets: [{ id: block.assetId, title: block.note ?? "附件", kind: "attachment" }],
        })];
      case "code":
        return [syncRecordRefsFromContent({
          ...base,
          contentHtml: `<pre><code>${escapeHtml(block.code)}</code></pre>`,
        })];
      case "formula":
        return [syncRecordRefsFromContent({
          ...base,
          formulas: [{ id: `${block.id}-formula`, title: "公式", latex: block.latex }],
        })];
      case "todo":
        return [syncRecordRefsFromContent({
          ...base,
          contentHtml: `<h2>${escapeHtml(block.title)}</h2><ul>${block.items
            .map((item) => `<li>${item.done ? "[x]" : "[ ]"} ${escapeHtml(item.text)}</li>`)
            .join("")}</ul>`,
        })];
      case "studySession":
        return [syncRecordRefsFromContent({
          ...base,
          contentHtml: `<p>学习时长：${block.minutes} 分钟${block.note ? `，${escapeHtml(block.note)}` : ""}</p>`,
        })];
      case "quote":
        return [syncRecordRefsFromContent({
          ...base,
          contentHtml: `<blockquote>${escapeHtml(block.text)}${block.source ? `<br>${escapeHtml(block.source)}` : ""}</blockquote>`,
        })];
    }
  });
};
