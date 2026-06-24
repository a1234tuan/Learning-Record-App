import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RichTextEditor } from "./RichTextEditor";

describe("RichTextEditor", () => {
  it("renders an ordered-list toolbar action", () => {
    render(<RichTextEditor value="<p>Item</p>" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "有序列表" })).toBeInTheDocument();
  });
});
