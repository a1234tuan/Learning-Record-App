import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";

import {
  createDefaultComparisonTable,
  createDefaultStructureDiagram,
  serializeStructureData,
} from "../lib/recordStructureBlocks";
import { RichTextEditor } from "./RichTextEditor";

const setSelectionInsideText = (editor: Editor, text: string) => {
  let targetPos: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) {
      targetPos = pos + 1;
      return false;
    }
    return true;
  });
  if (targetPos === undefined) {
    throw new Error(`Text not found: ${text}`);
  }
  editor.commands.setTextSelection(targetPos);
};

describe("RichTextEditor", () => {
  it("renders an ordered-list toolbar action", () => {
    render(<RichTextEditor value="<p>Item</p>" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "有序列表" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "高亮块" })).toBeInTheDocument();
  });

  it("inserts a highlight block from the toolbar", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p>Item</p>" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "高亮块" }));
    fireEvent.click(await screen.findByRole("button", { name: "浅粉色" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringContaining("record-highlight-block")));
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('data-tone="pink"');
  });

  it("changes the active highlight tone instead of nesting another block", async () => {
    const onChange = vi.fn();
    let editorRef: Editor | undefined;

    render(
      <RichTextEditor
        value='<record-highlight-block data-tone="yellow"><p>重要内容</p></record-highlight-block><p>后文</p>'
        onChange={onChange}
        renderInsertTools={(editor) => {
          editorRef = editor;
          return null;
        }}
      />,
    );

    await waitFor(() => expect(editorRef).toBeDefined());
    act(() => setSelectionInsideText(editorRef as Editor, "重要内容"));
    fireEvent.click(screen.getByRole("button", { name: "高亮块" }));
    fireEvent.click(await screen.findByRole("button", { name: "浅粉色" }));

    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] ?? "";
      expect(html).toContain('data-tone="pink"');
      expect(html.match(/<record-highlight-block/g) ?? []).toHaveLength(1);
    });
  });

  it("renders highlight block tone choices without clipping inside the editor", async () => {
    render(
      <RichTextEditor
        value='<record-highlight-block data-tone="yellow"><p>重要内容</p></record-highlight-block>'
        onChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(document.querySelector(".record-highlight-block.highlight-yellow")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "高亮颜色" }));

    expect(await screen.findByText("浅绿色")).toBeInTheDocument();
    expect(screen.getByText("浅黄色")).toBeInTheDocument();
    expect(screen.getByText("浅粉色")).toBeInTheDocument();
  });

  it("renders all highlight block tone classes and data attributes", async () => {
    render(
      <RichTextEditor
        value={[
          '<record-highlight-block data-tone="green"><p>绿色重点</p></record-highlight-block>',
          '<record-highlight-block data-tone="yellow"><p>黄色重点</p></record-highlight-block>',
          '<record-highlight-block data-tone="pink"><p>粉色重点</p></record-highlight-block>',
        ].join("")}
        onChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(document.querySelectorAll(".record-highlight-block")).toHaveLength(3));
    for (const tone of ["green", "yellow", "pink"]) {
      expect(document.querySelector(`.record-highlight-block.highlight-${tone}[data-tone="${tone}"]`)).toBeInTheDocument();
    }
  });

  it("deletes only the targeted nested highlight block", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        value={[
          '<record-highlight-block data-tone="green"><p>外层</p>',
          '<record-highlight-block data-tone="pink"><p>内层</p></record-highlight-block>',
          "</record-highlight-block>",
        ].join("")}
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(document.querySelectorAll(".record-highlight-block")).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: "删除高亮块" })[1]);

    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] ?? "";
      expect(html).toContain("外层");
      expect(html).not.toContain("内层");
      expect(html.match(/<record-highlight-block/g) ?? []).toHaveLength(1);
    });
  });

  it("renders structure diagrams as flow views and comparison blocks as tables in read-only mode", async () => {
    const diagram = createDefaultStructureDiagram();
    diagram.title = "Layers";
    diagram.chain[0] = {
      ...diagram.chain[0],
      title: "Parent",
      branches: [[{ ...diagram.chain[0], id: "branch", title: "Branch child", branches: [] }]],
    };
    const comparison = createDefaultComparisonTable();
    comparison.columns = comparison.columns.map((column, index) => ({
      ...column,
      label: ["Concept", "Role", "Analogy", "Pitfall"][index] ?? column.label,
    }));
    comparison.rows[0].cells[comparison.columns[0].id] = "Logical file system";

    render(
      <RichTextEditor
        value={[
          `<record-structure-diagram data-json='${serializeStructureData(diagram)}'></record-structure-diagram>`,
          "<p></p>",
          `<record-comparison-table data-json='${serializeStructureData(comparison)}'></record-comparison-table>`,
        ].join("")}
        onChange={vi.fn()}
        readOnly
      />,
    );

    await waitFor(() => expect(document.querySelector(".structure-flow-view")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".structure-flow-branch")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".comparison-table-view")).toBeInTheDocument());
    expect(document.querySelector("th.sticky-column")).toHaveTextContent("Concept");
  });
});
