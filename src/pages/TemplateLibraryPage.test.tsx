import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TemplateLibraryPage } from "./TemplateLibraryPage";

describe("TemplateLibraryPage", () => {
  it("opens and focuses a collapse summary inserted from the template editor menu", async () => {
    render(
      <TemplateLibraryPage
        templates={[]}
        onBack={vi.fn()}
        onSaveTemplate={vi.fn(async (template) => template)}
        onDeleteTemplate={vi.fn()}
        onSaveAsset={vi.fn()}
        onRenameAsset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.click(screen.getByRole("button", { name: "结构块" }));
    fireEvent.click(await screen.findByRole("button", { name: /折叠块/ }));

    const summaryInput = await screen.findByPlaceholderText("摘要标签");
    await waitFor(() => expect(summaryInput).toHaveFocus());
    expect((document.querySelector(".collapse-block-content") as HTMLElement).style.display).not.toBe("none");
    const defaultOpen = screen.getByRole("checkbox");
    expect(defaultOpen).not.toBeChecked();
  });
});
