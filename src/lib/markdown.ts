import type { Asset, Block, DayEntry, MistakeCard } from "../types";
import { recordToLinearMarkdown } from "./recordContent";

const stripHtml = (html: string): string =>
  html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
    .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

export const blockToMarkdown = (block: Block, assets: Asset[] = []): string => {
  switch (block.type) {
    case "record":
      return recordToLinearMarkdown(block, assets);
    case "richText":
      return stripHtml(block.content);
    case "code":
      return `\`\`\`${block.language}\n${block.code}\n\`\`\``;
    case "formula":
      return `$$\n${block.latex}\n$$`;
    case "todo":
      return [`### ${block.title}`, ...block.items.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`)].join(
        "\n",
      );
    case "studySession":
      return `> 学习时长：${block.subject} ${block.minutes} 分钟${block.note ? `，${block.note}` : ""}`;
    case "quote":
      return `> ${block.text}${block.source ? `\n>\n> ${block.source}` : ""}`;
    case "image":
      return `![${block.caption ?? "图片"}](../assets/${block.assetId})`;
    case "attachment":
      return `[附件](../assets/${block.assetId})${block.note ? `：${block.note}` : ""}`;
    case "mistakeRef":
      return "";
  }
};

export const entryToMarkdown = (entry: DayEntry, blocks: Block[], assets: Asset[] = []): string => {
  const frontMatter = [
    "---",
    `date: ${entry.date}`,
    `title: ${entry.title}`,
    `tags: [${entry.tags.join(", ")}]`,
    `pinned: ${entry.pinned}`,
    `favorite: ${entry.favorite}`,
    "---",
  ].join("\n");

  return [
    frontMatter,
    "",
    `# ${entry.title}`,
    "",
    ...blocks.sort((a, b) => a.order - b.order).map((block) => blockToMarkdown(block, assets)),
    "",
  ].join("\n");
};

export const mistakeToMarkdown = (mistake: MistakeCard): string =>
  [
    `# ${mistake.title}`,
    "",
    `- 科目：${mistake.subject}`,
    `- 章节：${mistake.chapter ?? "未填写"}`,
    `- 来源：${mistake.source ?? "未填写"}`,
    `- 难度：${mistake.difficulty}`,
    `- 掌握程度：${mistake.mastery}`,
    `- 标签：${mistake.tags.join(", ") || "无"}`,
    "",
    "## 题目",
    mistake.prompt,
    "",
    "## 我的错误",
    mistake.wrongAnswer ?? "未填写",
    "",
    "## 正确解法",
    mistake.correctAnswer,
    "",
    "## 错误原因",
    mistake.reason ?? "未填写",
    "",
    "## 反思",
    mistake.reflection ?? "未填写",
    "",
  ].join("\n");
