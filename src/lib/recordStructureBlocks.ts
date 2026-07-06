import { newId } from "./entity";

export type StructureBlockKind = "diagram" | "comparison" | "sticky" | "collapse";

export interface StructureDiagramNode {
  id: string;
  title: string;
  body: string;
  note: string;
  pitfall: string;
  branches: StructureDiagramNode[][];
}

export interface StructureDiagramData {
  title: string;
  orientation: "vertical" | "horizontal";
  chain: StructureDiagramNode[];
}

export interface ComparisonColumn {
  id: string;
  label: string;
}

export interface ComparisonRow {
  id: string;
  cells: Record<string, string>;
}

export interface ComparisonTableData {
  title: string;
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
}

export type StickyNoteType = "concept" | "example" | "analogy" | "question" | "pitfall";

export interface StickyNote {
  id: string;
  type: StickyNoteType;
  text: string;
}

export interface StickyBoardData {
  title: string;
  collapsedTypes: StickyNoteType[];
  notes: StickyNote[];
}

export const stickyTypeLabels: Record<StickyNoteType, string> = {
  concept: "概念",
  example: "例子",
  analogy: "类比",
  question: "疑问",
  pitfall: "易错点",
};

const createDiagramNode = (title = ""): StructureDiagramNode => ({
  id: newId(),
  title,
  body: "",
  note: "",
  pitfall: "",
  branches: [],
});

export const createDefaultStructureDiagram = (): StructureDiagramData => ({
  title: "结构图",
  orientation: "horizontal",
  chain: [createDiagramNode("核心概念")],
});

export const createBlankStructureNode = (): StructureDiagramNode => createDiagramNode();

const defaultColumns = (): ComparisonColumn[] => [
  { id: newId(), label: "概念" },
  { id: newId(), label: "作用" },
  { id: newId(), label: "类比" },
  { id: newId(), label: "易错点" },
];

const createRowForColumns = (columns: ComparisonColumn[]): ComparisonRow => ({
  id: newId(),
  cells: Object.fromEntries(columns.map((column) => [column.id, ""])),
});

export const createDefaultComparisonTable = (): ComparisonTableData => {
  const columns = defaultColumns();
  return {
    title: "对照/类比表",
    columns,
    rows: [createRowForColumns(columns)],
  };
};

export const createComparisonRow = (columns: ComparisonColumn[]): ComparisonRow => createRowForColumns(columns);

export const createComparisonColumn = (label = "新列"): ComparisonColumn => ({ id: newId(), label });

export const createDefaultStickyBoard = (): StickyBoardData => ({
  title: "思维便签板",
  collapsedTypes: [],
  notes: [
    { id: newId(), type: "concept", text: "" },
    { id: newId(), type: "analogy", text: "" },
    { id: newId(), type: "question", text: "" },
  ],
});

export const createStickyNote = (type: StickyNoteType = "concept"): StickyNote => ({
  id: newId(),
  type,
  text: "",
});

export const serializeStructureData = (value: unknown): string => JSON.stringify(value);

const parseData = <T>(value: unknown, fallback: () => T): T => {
  if (typeof value !== "string" || !value.trim()) {
    return fallback();
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback();
  }
};

export const parseStructureDiagramData = (value: unknown): StructureDiagramData =>
  parseData(value, createDefaultStructureDiagram);

export const parseComparisonTableData = (value: unknown): ComparisonTableData =>
  parseData(value, createDefaultComparisonTable);

export const parseStickyBoardData = (value: unknown): StickyBoardData =>
  parseData(value, createDefaultStickyBoard);

const compact = (parts: Array<string | undefined>): string => parts.map((part) => part?.trim()).filter(Boolean).join("；");

const diagramChainToLines = (chain: StructureDiagramNode[], depth = 0): string[] =>
  chain.flatMap((node, index) => {
    const prefix = `${"  ".repeat(depth)}${index + 1}. `;
    const line = compact([
      node.title || "未命名节点",
      node.body && `说明：${node.body}`,
      node.note && `旁注：${node.note}`,
      node.pitfall && `易错：${node.pitfall}`,
    ]);
    const branchLines = node.branches.flatMap((branch, branchIndex) => [
      `${"  ".repeat(depth + 1)}分叉 ${branchIndex + 1}:`,
      ...diagramChainToLines(branch, depth + 2),
    ]);
    return [`${prefix}${line}`, ...branchLines];
  });

export const structureDiagramToPlainText = (data: StructureDiagramData): string =>
  [data.title, ...diagramChainToLines(data.chain)].filter(Boolean).join("\n");

export const structureDiagramToMarkdown = (data: StructureDiagramData): string =>
  [`### ${data.title || "结构图"}`, ...diagramChainToLines(data.chain)].join("\n");

export const comparisonTableToPlainText = (data: ComparisonTableData): string => {
  const rows = data.rows.map((row) =>
    data.columns
      .map((column) => `${column.label}：${row.cells[column.id] ?? ""}`)
      .filter((item) => !item.endsWith("："))
      .join("；"),
  );
  return [data.title, ...rows].filter(Boolean).join("\n");
};

export const comparisonTableToMarkdown = (data: ComparisonTableData): string => {
  const headers = data.columns.map((column) => column.label || "列");
  const separator = headers.map(() => "---");
  const rows = data.rows.map((row) => data.columns.map((column) => row.cells[column.id] ?? ""));
  return [
    `### ${data.title || "对照/类比表"}`,
    `| ${headers.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
};

export const stickyBoardToPlainText = (data: StickyBoardData): string => {
  const notes = data.notes.map((note) => `${stickyTypeLabels[note.type]}：${note.text}`).filter((line) => !line.endsWith("："));
  return [data.title, ...notes].filter(Boolean).join("\n");
};

export const stickyBoardToMarkdown = (data: StickyBoardData): string => {
  const lines = [`### ${data.title || "思维便签板"}`];
  for (const type of Object.keys(stickyTypeLabels) as StickyNoteType[]) {
    const notes = data.notes.filter((note) => note.type === type && note.text.trim());
    if (notes.length === 0) {
      continue;
    }
    lines.push(`\n#### ${stickyTypeLabels[type]}`, ...notes.map((note) => `- ${note.text}`));
  }
  return lines.join("\n");
};

export const structureBlockPlainTextFromElement = (element: Element): string => {
  const tag = element.tagName.toLowerCase();
  if (tag === "record-structure-diagram") {
    return structureDiagramToPlainText(parseStructureDiagramData(element.getAttribute("data-json")));
  }
  if (tag === "record-comparison-table") {
    return comparisonTableToPlainText(parseComparisonTableData(element.getAttribute("data-json")));
  }
  if (tag === "record-sticky-board") {
    return stickyBoardToPlainText(parseStickyBoardData(element.getAttribute("data-json")));
  }
  return "";
};

export const structureBlockMarkdownFromElement = (element: Element): string => {
  const tag = element.tagName.toLowerCase();
  if (tag === "record-structure-diagram") {
    return structureDiagramToMarkdown(parseStructureDiagramData(element.getAttribute("data-json")));
  }
  if (tag === "record-comparison-table") {
    return comparisonTableToMarkdown(parseComparisonTableData(element.getAttribute("data-json")));
  }
  if (tag === "record-sticky-board") {
    return stickyBoardToMarkdown(parseStickyBoardData(element.getAttribute("data-json")));
  }
  return "";
};
