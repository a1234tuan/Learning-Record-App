import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./clipboard";

const defineClipboard = (clipboard: Clipboard | undefined) => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
};

const defineExecCommand = (execCommand: (commandId: string) => boolean) => {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
};

describe("copyTextToClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    defineClipboard(undefined);
    defineExecCommand(undefined as unknown as (commandId: string) => boolean);
  });

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    defineClipboard({ writeText } as unknown as Clipboard);

    await expect(copyTextToClipboard("markdown")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("markdown");
  });

  it("falls back to a hidden textarea when navigator.clipboard rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    defineClipboard({ writeText } as unknown as Clipboard);
    const execCommand = vi.fn().mockReturnValue(true);
    defineExecCommand(execCommand);

    await expect(copyTextToClipboard("fallback text")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).not.toBeInTheDocument();
  });

  it("returns false when both clipboard paths fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    defineClipboard({ writeText } as unknown as Clipboard);
    defineExecCommand(vi.fn().mockReturnValue(false));

    await expect(copyTextToClipboard("nope")).resolves.toBe(false);
  });
});
