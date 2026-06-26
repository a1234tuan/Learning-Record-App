import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RecordBlock, SubjectConfig } from "../types";

vi.mock("../components/RichTextEditor", () => ({
  RichTextEditor: () => <div data-testid="rich-editor" />,
}));

import { RecordEditorPage } from "./RecordEditorPage";

const stamp = "2026-06-21T00:00:00.000Z";

const record: RecordBlock = {
  id: "record-1",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject: "Math",
  title: "Math note 1",
  contentHtml: "<p></p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
  favorite: false,
};

const subjects: SubjectConfig[] = [
  {
    id: "subject-math",
    createdAt: stamp,
    updatedAt: stamp,
    name: "Math",
    order: 0,
  },
];

describe("RecordEditorPage", () => {
  it("does not expose subject creation while editing a record", async () => {
    const onGetDraft = vi.fn().mockResolvedValue(undefined);

    render(
      <RecordEditorPage
        record={record}
        initialEditing
        onBack={vi.fn()}
        onSave={vi.fn().mockResolvedValue(record)}
        onDelete={vi.fn()}
        onToggleFavorite={vi.fn()}
        onAddAsset={vi.fn()}
        subjects={subjects}
        onGetDraft={onGetDraft}
        onSaveDraft={vi.fn()}
        onDeleteDraft={vi.fn()}
      />,
    );

    await waitFor(() => expect(onGetDraft).toHaveBeenCalledWith(record.id));

    expect(screen.queryByRole("button", { name: /create subject/i })).not.toBeInTheDocument();
  });

  it("switches to read-only after saving the record", async () => {
    const onGetDraft = vi.fn().mockResolvedValue(undefined);
    const onSave = vi.fn().mockResolvedValue(record);

    render(
      <RecordEditorPage
        record={record}
        initialEditing
        onBack={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
        onToggleFavorite={vi.fn()}
        onAddAsset={vi.fn()}
        subjects={subjects}
        onGetDraft={onGetDraft}
        onSaveDraft={vi.fn()}
        onDeleteDraft={vi.fn()}
      />,
    );

    await waitFor(() => expect(onGetDraft).toHaveBeenCalledWith(record.id));
    fireEvent.click(screen.getAllByRole("button")[3]);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Math note 1" })).toBeInTheDocument();
  });
});
