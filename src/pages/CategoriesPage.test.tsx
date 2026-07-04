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

const record = (subject: string): RecordBlock => ({
  id: `record-${subject}`,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject,
  title: `${subject}记录`,
  contentHtml: "<p></p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
});

const createSaveSubjectsMock = (): SaveSubjectsMock =>
  vi.fn(async (_subjects: SubjectConfig[]) => undefined);

const renderPage = (blocks: Block[] = [], onSaveSubjects: SaveSubjectsMock = createSaveSubjectsMock()) => render(
  <CategoriesPage
    blocks={blocks}
    subjects={subjects}
    activeSubject={null}
    managing
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
  it("deletes a subject config when no records reference it", async () => {
    const onSaveSubjects = createSaveSubjectsMock();
    renderPage([], onSaveSubjects);

    fireEvent.click(screen.getByRole("button", { name: "删除学科 读书笔记" }));

    await waitFor(() => expect(onSaveSubjects).toHaveBeenCalledTimes(1));
    const savedSubjects = onSaveSubjects.mock.calls[0]?.[0];
    expect(savedSubjects?.map((subject: SubjectConfig) => subject.name)).toEqual(["数学"]);
    expect(savedSubjects?.[0]?.order).toBe(0);
  });

  it("blocks deleting a subject that still has records", async () => {
    const onSaveSubjects = createSaveSubjectsMock();
    renderPage([record("数学")], onSaveSubjects);

    fireEvent.click(screen.getByRole("button", { name: "删除学科 数学" }));

    expect(onSaveSubjects).not.toHaveBeenCalled();
    expect(screen.getByText("该学科已有学习记录，不能直接删除。可以先归档、改名，或把记录迁移到其他学科。")).toBeInTheDocument();
  });
});
