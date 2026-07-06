import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { CategoriesPage } from "./CategoriesPage";
import type { Block, RecordBlock, SubjectConfig } from "../types";

vi.mock("../components/RecordCard", () => ({
  RecordCard: ({ record }: { record: RecordBlock }) => <article>{record.title}</article>,
}));

const stamp = "2026-06-21T00:00:00.000Z";

const subjects: SubjectConfig[] = [
  { id: "subject-reading", createdAt: stamp, updatedAt: stamp, name: "读书笔记", order: 0 },
  { id: "subject-math", createdAt: stamp, updatedAt: stamp, name: "数学", order: 1 },
];

type SaveSubjectsMock = Mock<(subjects: SubjectConfig[]) => Promise<void>>;

const record = (subject: string, overrides: Partial<RecordBlock> = {}): RecordBlock => ({
  id: overrides.id ?? `record-${subject}`,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: overrides.date ?? "2026-06-21",
  order: overrides.order ?? 0,
  subject,
  title: overrides.title ?? `${subject}记录`,
  contentHtml: "<p></p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
  ...overrides,
});

const createSaveSubjectsMock = (): SaveSubjectsMock =>
  vi.fn(async (_subjects: SubjectConfig[]) => undefined);

const renderPage = (
  blocks: Block[] = [],
  onSaveSubjects: SaveSubjectsMock = createSaveSubjectsMock(),
  options: { activeSubject?: string | null; managing?: boolean } = {},
) => render(
  <CategoriesPage
    blocks={blocks}
    subjects={subjects}
    activeSubject={options.activeSubject ?? null}
    managing={options.managing ?? true}
    onActiveSubjectChange={vi.fn()}
    onManagingChange={vi.fn()}
    onOpenRecord={vi.fn()}
    onAddSubject={vi.fn()}
    onRenameSubject={vi.fn()}
    onSaveSubjects={onSaveSubjects}
    onToggleFavorite={vi.fn()}
  />,
);

describe("CategoriesPage", () => {
  it("requires inline confirmation before deleting a subject config with no records", async () => {
    const onSaveSubjects = createSaveSubjectsMock();
    renderPage([], onSaveSubjects);

    fireEvent.click(screen.getByRole("button", { name: "删除学科 读书笔记" }));

    expect(onSaveSubjects).not.toHaveBeenCalled();
    expect(screen.getByText("确认删除“读书笔记”？这只会删除学科配置，不会删除记录。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(onSaveSubjects).toHaveBeenCalledTimes(1));
    const savedSubjects = onSaveSubjects.mock.calls[0]?.[0];
    expect(savedSubjects?.map((subject: SubjectConfig) => subject.name)).toEqual(["数学"]);
    expect(savedSubjects?.[0]?.order).toBe(0);
  });

  it("cancels an inline subject deletion confirmation", () => {
    const onSaveSubjects = createSaveSubjectsMock();
    renderPage([], onSaveSubjects);

    fireEvent.click(screen.getByRole("button", { name: "删除学科 读书笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onSaveSubjects).not.toHaveBeenCalled();
    expect(screen.queryByText("确认删除“读书笔记”？这只会删除学科配置，不会删除记录。")).not.toBeInTheDocument();
  });

  it("blocks deleting a subject that still has records", async () => {
    const onSaveSubjects = createSaveSubjectsMock();
    renderPage([record("数学")], onSaveSubjects);

    fireEvent.click(screen.getByRole("button", { name: "删除学科 数学" }));

    expect(onSaveSubjects).not.toHaveBeenCalled();
    const mathRow = screen.getByText("数学").closest(".subject-manager-row");
    expect(mathRow).toHaveTextContent("该学科已有学习记录，不能直接删除。可以先归档、改名，或把记录迁移到其他学科。");
  });

  it("groups subject records by month and only renders the first page of each expanded month", () => {
    const julyRecords = Array.from({ length: 60 }, (_, index) =>
      record("数学", {
        id: `july-${index}`,
        date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
        order: index,
        title: `七月记录 ${index + 1}`,
      }),
    );
    const juneRecords = Array.from({ length: 10 }, (_, index) =>
      record("数学", {
        id: `june-${index}`,
        date: `2026-06-${String((index % 28) + 1).padStart(2, "0")}`,
        order: index,
        title: `六月记录 ${index + 1}`,
      }),
    );

    renderPage([...juneRecords, ...julyRecords], createSaveSubjectsMock(), {
      activeSubject: "数学",
      managing: false,
    });

    expect(screen.getByRole("button", { name: /2026年07月/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /2026年06月/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByText(/七月记录 /)).toHaveLength(50);
    expect(screen.queryByText(/六月记录 /)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /显示更多/ }));

    expect(screen.getAllByText(/七月记录 /)).toHaveLength(60);
  });
});
