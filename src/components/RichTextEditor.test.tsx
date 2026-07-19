import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";

import {
  createDefaultComparisonTable,
  createDefaultStickyBoard,
  createDefaultStructureDiagram,
  serializeStructureData,
} from "../lib/recordStructureBlocks";
import { RichTextEditor } from "./RichTextEditor";

vi.mock("./AssetPreview", () => ({
  AssetPreview: () => <article className="asset-card asset-card-view compact-image-card" data-testid="asset-preview" />,
}));

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
    expect(screen.getByRole("combobox", { name: "标题级别" })).toBeInTheDocument();
  });

  it("converts pasted Markdown with formulas into editor nodes", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p></p>" onChange={onChange} />);

    const editor = document.querySelector(".rich-editor")!;
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "# 标题\n\n行内 $x^2$\n\n$$\ny=x\n$$" : "",
        items: [],
      },
    });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("record-inline-math"));
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("record-formula");
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h1>标题</h1>");
  });

  it("prefers the actual Markdown source from a Windows clipboard and accepts single-line block math", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p></p>" onChange={onChange} />);

    fireEvent.paste(document.querySelector(".rich-editor")!, {
      clipboardData: {
        getData: (type: string) => {
          if (type === "text/markdown") return "Copied rich text";
          if (type === "text/plain") return "$\\lim_{x \\to 0^+} \\frac{f(x)}{ax^b} = 1$\n\n$$E=mc^2$$\n\n*斜体*";
          return "";
        },
        items: [],
      },
    });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("record-inline-math"));
    const html = onChange.mock.calls.at(-1)?.[0] ?? "";
    expect(html).toContain('data-latex="\\lim_{x \\to 0^+} \\frac{f(x)}{ax^b} = 1"');
    expect(html).toContain('data-latex="E=mc^2"');
    expect(html).toContain("<em>斜体</em>");
  });

  it("immediately converts Markdown typed next to Chinese text", async () => {
    let editorRef: Editor | undefined;
    render(
      <RichTextEditor
        value="<p></p>"
        onChange={vi.fn()}
        renderInsertTools={(editor) => {
          editorRef = editor;
          return null;
        }}
      />,
    );

    await waitFor(() => expect(editorRef).toBeDefined());
    act(() => {
      editorRef?.commands.insertContent("中文**粗体**", { applyInputRules: true });
    });
    await waitFor(() => expect(editorRef?.getHTML()).toContain("中文<strong>粗体</strong>"));

    act(() => {
      editorRef?.commands.insertContent("以及*斜体*", { applyInputRules: true });
    });
    await waitFor(() => expect(editorRef?.getHTML()).toContain("<em>斜体</em>"));
  });

  it("creates inline and block formulas from direct Markdown input", async () => {
    let editorRef: Editor | undefined;
    render(
      <RichTextEditor
        value="<p></p>"
        onChange={vi.fn()}
        renderInsertTools={(editor) => {
          editorRef = editor;
          return null;
        }}
      />,
    );

    await waitFor(() => expect(editorRef).toBeDefined());
    act(() => {
      editorRef?.commands.insertContent("$x^2$", { applyInputRules: true });
    });
    await waitFor(() => expect(editorRef?.getHTML()).toContain("record-inline-math"));

    act(() => {
      editorRef?.commands.setContent("<p></p>");
      editorRef?.commands.insertContent("$$ ", { applyInputRules: true });
    });
    await waitFor(() => expect(editorRef?.getHTML()).toContain("record-formula"));
    expect(await screen.findByLabelText("块公式")).toBeInTheDocument();
  });

  it("creates a block formula on Enter and leaves Markdown literal inside code", async () => {
    let editorRef: Editor | undefined;
    render(
      <RichTextEditor
        value="<p></p>"
        onChange={vi.fn()}
        renderInsertTools={(editor) => {
          editorRef = editor;
          return null;
        }}
      />,
    );

    await waitFor(() => expect(editorRef).toBeDefined());
    act(() => {
      editorRef?.commands.insertContent("$$");
    });
    fireEvent.keyDown(document.querySelector(".rich-editor")!, { key: "Enter" });
    await waitFor(() => expect(editorRef?.getHTML()).toContain("record-formula"));

    act(() => {
      editorRef?.commands.setContent("<pre><code></code></pre>");
      editorRef?.commands.focus("end");
      editorRef?.commands.insertContent("$x$", { applyInputRules: true });
    });
    await waitFor(() => expect(editorRef?.getHTML()).toContain("$x$"));
    expect(editorRef?.getHTML()).not.toContain("record-inline-math");
  });

  it("renders formulas in edit mode and opens a source input only when selected", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        value='<p>结论 <record-inline-math data-formula-id="f1" data-latex="x^2"></record-inline-math></p>'
        onChange={onChange}
      />,
    );

    let formula: Element | null = null;
    await waitFor(() => {
      formula = document.querySelector(".record-inline-math");
      expect(formula).toBeInTheDocument();
      expect(formula?.querySelector(".katex")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("行内公式")).not.toBeInTheDocument();

    fireEvent.click(formula!);
    const input = await screen.findByLabelText("行内公式");
    fireEvent.change(input, { target: { value: "y^2" } });
    fireEvent.blur(input);

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain('data-latex="y^2"'));
    expect(screen.queryByLabelText("行内公式")).not.toBeInTheDocument();
  });

  it("converts Markdown lists, quote, code and inline marks with the Tiptap schema", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p></p>" onChange={onChange} />);

    const editor = document.querySelector(".rich-editor")!;
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => type === "text/plain"
          ? [
            "### 第三级标题",
            "",
            "> 引用内容",
            "",
            "- 无序项",
            "",
            "3. 有序项",
            "",
            "**加粗**和*斜体*以及`行内代码`",
            "",
            "```javascript",
            "const total = 1;",
            "```",
          ].join("\n")
          : "",
        items: [],
      },
    });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h3>第三级标题</h3>"));
    const html = onChange.mock.calls.at(-1)?.[0] ?? "";
    expect(html).toContain("<blockquote><p>引用内容</p></blockquote>");
    expect(html).toContain("<ul><li><p>无序项</p></li></ul>");
    expect(html).toContain('<ol start="3"><li><p>有序项</p></li></ol>');
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<code>行内代码</code>");
    expect(html).toContain('language-javascript');
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

  it("renders mixed media, collapse and structure blocks inside bounded editor nodes in read-only mode", async () => {
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
    const sticky = createDefaultStickyBoard();
    sticky.notes[0].text = "A long local-search note should wrap inside the sticky card instead of widening the record page.";

    render(
      <RichTextEditor
        value={[
          '<record-asset data-asset-id="asset-1" data-kind="image" data-title="diagram.png"></record-asset>',
          '<record-collapse data-title="折叠块" data-summary="包含宽内容" data-default-open="true">',
          `<record-structure-diagram data-json='${serializeStructureData(diagram)}'></record-structure-diagram>`,
          "<p></p>",
          `<record-comparison-table data-json='${serializeStructureData(comparison)}'></record-comparison-table>`,
          `<record-sticky-board data-json='${serializeStructureData(sticky)}'></record-sticky-board>`,
          "</record-collapse>",
        ].join("")}
        onChange={vi.fn()}
        readOnly
      />,
    );

    await waitFor(() => expect(document.querySelector(".structure-flow-view")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".structure-flow-branch")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".comparison-table-view")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".comparison-panel-view")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".collapse-block-content")).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".sticky-board-view")).toBeInTheDocument());
    expect(document.querySelector(".record-inline-node")).toBeInTheDocument();
    expect(document.querySelector(".comparison-fixed-panel")).toBeInTheDocument();
    expect(document.querySelector(".comparison-table-right-scroll")).toBeInTheDocument();
    expect(document.querySelector('[role="columnheader"].sticky-column')).toHaveTextContent("Concept");
    expect(document.querySelector('[role="cell"].sticky-column')).toHaveTextContent("Logical file system");
    expect(document.querySelectorAll(".comparison-table-right-scroll")).toHaveLength(1);
  });

  it("uses a single right-side scroller for read-only comparison table columns", async () => {
    const comparison = createDefaultComparisonTable();
    comparison.columns = comparison.columns.map((column, index) => ({
      ...column,
      label: ["Concept", "Role", "Analogy", "Pitfall"][index] ?? column.label,
    }));

    render(
      <RichTextEditor
        value={`<record-comparison-table data-json='${serializeStructureData(comparison)}'></record-comparison-table>`}
        onChange={vi.fn()}
        readOnly
      />,
    );

    await waitFor(() => expect(document.querySelector(".comparison-table-right-scroll")).toBeInTheDocument());
    expect(document.querySelector(".comparison-fixed-panel")).toBeInTheDocument();
    expect(document.querySelectorAll(".comparison-table-right-scroll")).toHaveLength(1);
    expect(document.querySelectorAll(".comparison-scroll-grid-row")).toHaveLength(comparison.rows.length + 1);

    const rightScroller = document.querySelector<HTMLDivElement>(".comparison-table-right-scroll")!;
    rightScroller.scrollLeft = 96;
    fireEvent.scroll(rightScroller);

    expect(rightScroller.scrollLeft).toBe(96);
  });
});
