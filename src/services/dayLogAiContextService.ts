import type {
  AiLogContextAttachment,
  AiSkippedAsset,
  Asset,
  Block,
  RecordBlock,
} from "../types";
import { parseLinearRecordContent } from "../lib/recordContent";
import { describeOcrForAi } from "./ocrDiagnostics";

const escapeMarkdown = (value: string): string => value.replace(/\r\n/g, "\n").trim();

const assetTitle = (asset: Asset | undefined, fallback: string): string =>
  [asset?.title, asset?.fileName, fallback].find((item) => item && item.trim()) ?? "资源";

const skipped = (asset: Asset | undefined, id: string, kind: AiSkippedAsset["kind"], reason: string): AiSkippedAsset => ({
  id,
  kind,
  title: assetTitle(asset, id),
  reason,
});

export const buildDayLogAiContext = (
  date: string,
  blocks: Block[],
  assets: Asset[],
): AiLogContextAttachment => {
  const records = blocks
    .filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt && block.date === date)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

  const warnings: string[] = [];
  const skippedAssets: AiSkippedAsset[] = [];
  const missingOcrAssetIds: string[] = [];
  let includedImages = 0;
  let skippedImages = 0;
  const lines: string[] = [
    `# ${date} 学习日志`,
    "",
    `> 下面内容来自本地学习日志。图片仅包含已完成 OCR 的文字；音频、PDF、附件不会参与问答。`,
    "",
  ];

  if (records.length === 0) {
    warnings.push("当天没有可用于 AI 问答的日志记录。");
  }

  for (const record of records) {
    lines.push(`## ${record.subject} / ${record.title}`, "");
    const nodes = parseLinearRecordContent(record, assets);
    if (nodes.length === 0) {
      lines.push("（空记录）", "");
      continue;
    }

    for (const node of nodes) {
      if (node.kind === "text") {
        lines.push(escapeMarkdown(node.text), "");
        continue;
      }

      if (node.kind === "formula") {
        if (node.formula.title) {
          lines.push(`### ${node.formula.title}`);
        }
        lines.push("$$", node.formula.latex, "$$", "");
        continue;
      }

      const kind = node.asset?.kind ?? node.ref.kind;
      const title = assetTitle(node.asset, node.ref.title);
      if (kind === "image") {
        const diagnostic = describeOcrForAi(node.asset);
        if (diagnostic.included && node.asset?.ocrText?.trim()) {
          includedImages += 1;
          lines.push(`### 图片文字：${title}`, node.asset.ocrText.trim(), "");
        } else {
          skippedImages += 1;
          missingOcrAssetIds.push(node.ref.id);
          skippedAssets.push(skipped(node.asset, node.ref.id, "image", diagnostic.reason));
        }
        continue;
      }

      skippedAssets.push(
        skipped(
          node.asset,
          node.ref.id,
          kind,
          kind === "audio" ? "音频文件暂不参与 AI 问答。" : "附件暂不参与 AI 问答。",
        ),
      );
    }
  }

  if (missingOcrAssetIds.length > 0) {
    warnings.push(`有 ${missingOcrAssetIds.length} 张图片未提供可用 OCR 文本，未参与本次问答。`);
  }
  const skippedNonImages = skippedAssets.filter((asset) => asset.kind !== "image");
  if (skippedNonImages.length > 0) {
    warnings.push(`有 ${skippedNonImages.length} 个音频或附件已跳过，不参与本次问答。`);
  }

  return {
    date,
    recordIds: records.map((record) => record.id),
    markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    warnings,
    skippedAssets,
    missingOcrAssetIds,
    ocrSummary: {
      includedImages,
      skippedImages,
    },
  };
};
