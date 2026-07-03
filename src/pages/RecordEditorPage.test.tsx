import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Asset, RecordBlock, RecordDraft, SubjectConfig } from "../types";

const richEditorMock = vi.hoisted(() => {
  const state: {
    html: string;
    props: any;
    editor: any;
    insertContentAt: ReturnType<typeof vi.fn>;
    reset: () => void;
  } = {
    html: "<p></p>",
    props: null,
    editor: null,
    insertContentAt: vi.fn(),
    reset: () => undefined,
  };

  state.insertContentAt = vi.fn((_pos: number, nodes: Array<{ type?: string; attrs?: Record<string, string> }>) => ({
    run: () => {
      const node = nodes[0];
      if (node?.type === "recordAsset") {
        const attrs = node.attrs ?? {};
        state.html = `<record-asset data-asset-id="${attrs.assetId}" data-kind="${attrs.kind}" data-title="${attrs.title}"></record-asset><p></p>`;
      } else {
        state.html = `<${node?.type ?? "unknown"}></${node?.type ?? "unknown"}><p></p>`;
      }
      state.props?.onChange?.(state.html);
      return true;
    },
  }));

  state.editor = {
    isDestroyed: false,
    getHTML: () => state.html,
    state: {
      selection: {
        $from: {
          depth: 0,
          end: () => 0,
        },
      },
    },
    chain: () => ({
      focus: () => ({
        insertContentAt: state.insertContentAt,
      }),
    }),
  };

  state.reset = () => {
    state.html = "<p></p>";
    state.props = null;
    state.editor.isDestroyed = false;
    state.insertContentAt.mockClear();
  };

  return state;
});

vi.mock("../components/RichTextEditor", () => ({
  RichTextEditor: (props: any) => {
    richEditorMock.props = props;
    richEditorMock.html = props.value;
    return (
      <div data-testid={props.readOnly ? "rich-viewer" : "rich-editor"}>
        {!props.readOnly && props.renderInsertTools?.(richEditorMock.editor)}
      </div>
    );
  },
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

const asset: Asset = {
  id: "asset-1",
  createdAt: stamp,
  updatedAt: stamp,
  kind: "image",
  fileName: "diagram.png",
  title: "diagram.png",
  mimeType: "image/png",
  size: 4,
  data: new File(["data"], "diagram.png", { type: "image/png" }),
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const renderEditor = (overrides: Partial<React.ComponentProps<typeof RecordEditorPage>> = {}) => {
  const onGetDraft = vi.fn().mockResolvedValue(undefined);
  const onSave = vi.fn().mockResolvedValue(record);
  const onSaveDraft = vi.fn(async (draft: RecordDraft) => draft);
  const onDeleteDraft = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <RecordEditorPage
      record={record}
      initialEditing
      onBack={vi.fn()}
      onSave={onSave}
      onDelete={vi.fn()}
      onToggleFavorite={vi.fn()}
      onAddAsset={vi.fn().mockResolvedValue(asset)}
      subjects={subjects}
      onGetDraft={onGetDraft}
      onSaveDraft={onSaveDraft}
      onDeleteDraft={onDeleteDraft}
      {...overrides}
    />,
  );

  const saveButton = () => view.container.querySelector(".record-action-row .primary-button") as HTMLButtonElement;
  return { ...view, onGetDraft, onSave, onSaveDraft, onDeleteDraft, saveButton };
};

afterEach(() => {
  vi.useRealTimers();
  richEditorMock.reset();
});

describe("RecordEditorPage", () => {
  it("does not expose subject creation while editing a record", async () => {
    const { onGetDraft } = renderEditor();

    await waitFor(() => expect(onGetDraft).toHaveBeenCalledWith(record.id));

    expect(screen.queryByRole("button", { name: /create subject/i })).not.toBeInTheDocument();
  });

  it("saves the latest editor html and switches to read-only with one click", async () => {
    const { onGetDraft, onSave, saveButton } = renderEditor();

    await waitFor(() => expect(onGetDraft).toHaveBeenCalledWith(record.id));

    act(() => {
      richEditorMock.html = "<record-collapse-block><p>body</p></record-collapse-block>";
      richEditorMock.props.onChange(richEditorMock.html);
    });

    fireEvent.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({
      contentHtml: "<record-collapse-block><p>body</p></record-collapse-block>",
    }));
    expect(screen.getByRole("heading", { name: "Math note 1" })).toBeInTheDocument();
  });

  it("waits for an in-flight draft save before deleting the draft and entering preview", async () => {
    const draftSave = deferred<RecordDraft>();
    let savedDraft!: RecordDraft;
    const onSaveDraft = vi.fn((draft: RecordDraft) => {
      savedDraft = draft;
      return draftSave.promise;
    });
    const onDeleteDraft = vi.fn().mockResolvedValue(undefined);
    const onSave = vi.fn().mockResolvedValue(record);
    const { onGetDraft, saveButton } = renderEditor({ onSave, onSaveDraft, onDeleteDraft });

    await waitFor(() => expect(onGetDraft).toHaveBeenCalledWith(record.id));

    act(() => {
      richEditorMock.html = "<p>queued draft</p>";
      richEditorMock.props.onChange(richEditorMock.html);
    });
    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledTimes(1));

    fireEvent.click(saveButton());
    await Promise.resolve();
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      draftSave.resolve(savedDraft);
      await draftSave.promise;
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onDeleteDraft).toHaveBeenCalledWith(record.id);
    expect(onSaveDraft.mock.invocationCallOrder[0]).toBeLessThan(onDeleteDraft.mock.invocationCallOrder[0]);
    expect(screen.getByRole("heading", { name: "Math note 1" })).toBeInTheDocument();
  });

  it("waits for a pending asset insertion before saving the record", async () => {
    const assetSave = deferred<Asset>();
    const onAddAsset = vi.fn(() => assetSave.promise);
    const onSave = vi.fn().mockResolvedValue(record);
    const { container, onGetDraft, saveButton } = renderEditor({ onAddAsset, onSave });

    await waitFor(() => expect(onGetDraft).toHaveBeenCalledWith(record.id));

    const input = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(["data"], "diagram.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(onAddAsset).toHaveBeenCalled());

    fireEvent.click(saveButton());
    await Promise.resolve();
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      assetSave.resolve(asset);
      await assetSave.promise;
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].contentHtml).toContain("record-asset");
    expect(onSave.mock.calls[0][0].contentHtml).toContain("asset-1");
    expect(screen.getByRole("heading", { name: "Math note 1" })).toBeInTheDocument();
  });

  it("keeps editing and preserves a draft when the formal save fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("disk full"));
    const onSaveDraft = vi.fn(async (draft: RecordDraft) => draft);
    const onDeleteDraft = vi.fn().mockResolvedValue(undefined);
    const { onGetDraft, saveButton } = renderEditor({ onSave, onSaveDraft, onDeleteDraft });

    await waitFor(() => expect(onGetDraft).toHaveBeenCalledWith(record.id));

    act(() => {
      richEditorMock.html = "<p>must survive</p>";
      richEditorMock.props.onChange(richEditorMock.html);
    });

    fireEvent.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled());
    expect(onSaveDraft.mock.calls.at(-1)?.[0].draft.contentHtml).toBe("<p>must survive</p>");
    expect(onDeleteDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId("rich-editor")).toBeInTheDocument();
  });
});
