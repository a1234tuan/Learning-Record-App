import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { CategoriesPage } from "./CategoriesPage";
import type { AiKnowledgeScope, Block, RecordBlock, SubjectConfig } from "../types";

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
  tags: [],
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
  options: {
    activeSubject?: string | null;
    managing?: boolean;
    onAskAiScope?: (scope: AiKnowledgeScope) => void;
    subjects?: SubjectConfig[];
  } = {},
) => render(
  <CategoriesPage
    blocks={blocks}
    subjects={options.subjects ?? subjects}
    activeSubject={options.activeSubject ?? null}
    managing={options.managing ?? true}
    onActiveSubjectChange={vi.fn()}
    onManagingChange={vi.fn()}
    onOpenRecord={vi.fn()}
    onAskAiScope={options.onAskAiScope}
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

  it("groups a multi-tag record under every tag without creating an untagged group", () => {
    renderPage([
      record("数学", { id: "multi", title: "双标签记录", tags: ["重点", "积分"] }),
      record("数学", { id: "single", title: "重点记录", tags: ["重点"] }),
    ], createSaveSubjectsMock(), { activeSubject: "数学", managing: false });

    fireEvent.click(screen.getByRole("tab", { name: "按标签" }));

    const toggles = screen.getAllByRole("button", { name: /日志标签：/ });
    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) {
      if (toggle.getAttribute("aria-expanded") !== "true") {
        fireEvent.click(toggle);
      }
    }

    expect(screen.getAllByText("双标签记录")).toHaveLength(2);
    expect(screen.queryByText("未分类")).not.toBeInTheDocument();
  });

  it("shows an empty tag view when no saved record has a tag", () => {
    renderPage([record("数学")], createSaveSubjectsMock(), { activeSubject: "数学", managing: false });

    fireEvent.click(screen.getByRole("tab", { name: "按标签" }));

    expect(screen.getByText("这个学科还没有标签。")).toBeInTheDocument();
  });

  it("opens a tag-scoped AI session from a tag group shortcut", () => {
    const onAskAiScope = vi.fn();
    renderPage(
      [record("数学", { id: "tagged", tags: ["专项突破"] })],
      createSaveSubjectsMock(),
      { activeSubject: "数学", managing: false, onAskAiScope },
    );

    fireEvent.click(screen.getByRole("tab", { name: "按标签" }));
    fireEvent.click(screen.getByRole("button", { name: "针对标签 专项突破 进行 AI 问答" }));

    expect(onAskAiScope).toHaveBeenCalledWith({ kind: "tag", subject: "数学", tag: "专项突破" });
  });

  it("archiving one subject does not bump updatedAt on subjects that were not touched", async () => {
    const onSaveSubjects = createSaveSubjectsMock();
    renderPage([], onSaveSubjects);

    // Row order matches `subjects`: 读书笔记 (index 0), 数学 (index 1). Archive toggle is the
    // 4th action button in each row (move-up, move-down, edit, archive, delete) — these icon-only
    // buttons have no aria-label, so select by row structure instead.
    const rows = document.querySelectorAll(".subject-manager-row");
    const mathArchiveButton = rows[1].querySelectorAll(".subject-manager-actions button")[3] as HTMLButtonElement;
    fireEvent.click(mathArchiveButton);

    await waitFor(() => expect(onSaveSubjects).toHaveBeenCalledTimes(1));
    const saved = onSaveSubjects.mock.calls[0]?.[0] as SubjectConfig[];
    const savedReading = saved.find((subject) => subject.name === "读书笔记");
    const savedMath = saved.find((subject) => subject.name === "数学");

    // Untouched subject keeps its original updatedAt (and object identity).
    expect(savedReading?.updatedAt).toBe(stamp);
    expect(savedReading).toBe(subjects[0]);
    // The archived subject genuinely changed (archivedAt flipped) and must get a fresh updatedAt.
    expect(savedMath?.archivedAt).toBeTruthy();
    expect(savedMath?.updatedAt).not.toBe(stamp);
  });

  it("reordering subjects does not bump updatedAt on the subject that stayed in place", async () => {
    // Three subjects so a swap between the last two leaves the first one genuinely untouched —
    // with only two subjects, any move is a full swap and neither side stays in place.
    const threeSubjects: SubjectConfig[] = [
      { id: "subject-reading", createdAt: stamp, updatedAt: stamp, name: "读书笔记", order: 0 },
      { id: "subject-math", createdAt: stamp, updatedAt: stamp, name: "数学", order: 1 },
      { id: "subject-physics", createdAt: stamp, updatedAt: stamp, name: "物理", order: 2 },
    ];
    const onSaveSubjects = createSaveSubjectsMock();
    renderPage([], onSaveSubjects, { subjects: threeSubjects });

    // Move 物理 (index 2) up by one — it swaps with 数学 (index 1); 读书笔记 (index 0) is not
    // touched by this move at all.
    const rows = document.querySelectorAll(".subject-manager-row");
    const physicsMoveUpButton = rows[2].querySelectorAll(".subject-manager-actions button")[0] as HTMLButtonElement;
    fireEvent.click(physicsMoveUpButton);

    await waitFor(() => expect(onSaveSubjects).toHaveBeenCalledTimes(1));
    const saved = onSaveSubjects.mock.calls[0]?.[0] as SubjectConfig[];
    const savedReading = saved.find((subject) => subject.name === "读书笔记");
    const savedMath = saved.find((subject) => subject.name === "数学");
    const savedPhysics = saved.find((subject) => subject.name === "物理");

    // 读书笔记 keeps order 0 and its original updatedAt/object identity — genuinely untouched.
    expect(savedReading?.order).toBe(0);
    expect(savedReading?.updatedAt).toBe(stamp);
    expect(savedReading).toBe(threeSubjects[0]);
    // 数学 and 物理 swapped places and must both get a fresh updatedAt.
    expect(savedMath?.order).toBe(2);
    expect(savedMath?.updatedAt).not.toBe(stamp);
    expect(savedPhysics?.order).toBe(1);
    expect(savedPhysics?.updatedAt).not.toBe(stamp);
  });
});
