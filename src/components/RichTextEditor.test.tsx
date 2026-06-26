import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  createDefaultComparisonTable,
  createDefaultStructureDiagram,
  serializeStructureData,
} from "../lib/recordStructureBlocks";
import { RichTextEditor } from "./RichTextEditor";

describe("RichTextEditor", () => {
  it("renders an ordered-list toolbar action", () => {
    render(<RichTextEditor value="<p>Item</p>" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "有序列表" })).toBeInTheDocument();
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
