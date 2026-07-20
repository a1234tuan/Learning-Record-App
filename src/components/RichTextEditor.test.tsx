import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";

import {
  createDefaultComparisonTable,
  createDefaultStickyBoard,
  createDefaultStructureDiagram,
  serializeStructureData,
} from "../lib/recordStructureBlocks";
import { readClipboardTextFallback } from "../lib/clipboard";
import { isNativePlatform } from "../lib/platform";
import { RichTextEditor } from "./RichTextEditor";

vi.mock("../lib/platform", () => ({
  isNativePlatform: vi.fn(() => false),
}));

vi.mock("../lib/clipboard", async () => {
  const actual = await vi.importActual<typeof import("../lib/clipboard")>("../lib/clipboard");
  return {
    ...actual,
    readClipboardTextFallback: vi.fn(),
  };
});

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

const nativeInputEvent = (type: "beforeinput" | "input", inputType: string): InputEvent => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as InputEvent;
  Object.defineProperty(event, "inputType", { configurable: true, value: inputType });
  Object.defineProperty(event, "isComposing", { configurable: true, value: false });
  return event;
};

const androidMarkdownSample = [
  "---",
  "",
  "### 整体规律总结",
  "",
  "- **破折号插入**：主语后紧跟一个由双破折号括起来的**名词短语同位语**。",
  "  - **被动不定式**：need **to be** encouraged",
].join("\r\n");

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

  it("parses a standalone multiline block formula paste", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p></p>" onChange={onChange} />);

    fireEvent.paste(document.querySelector(".rich-editor")!, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "$$\n\\int_0^1 x^2 dx\n$$" : "",
        items: [],
      },
    });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("record-formula"));
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('data-latex="\\int_0^1 x^2 dx"');
  });

  it("parses a complete plain-text Markdown paste with links and a horizontal rule", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p></p>" onChange={onChange} />);

    fireEvent.paste(document.querySelector(".rich-editor")!, {
      clipboardData: {
        getData: (type: string) => type === "text/plain"
          ? [
            "# Markdown 标题",
            "",
            "> 引用内容",
            "",
            "- 列表项",
            "",
            "**粗体**、*斜体*、`代码`和[链接](https://example.com)",
            "",
            "---",
            "",
            "行内公式 $x^2$",
          ].join("\n")
          : "",
        items: [],
      },
    });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h1>Markdown 标题</h1>"));
    const html = onChange.mock.calls.at(-1)?.[0] ?? "";
    expect(html).toContain("<blockquote><p>引用内容</p></blockquote>");
    expect(html).toContain("<ul><li><p>列表项</p></li></ul>");
    expect(html).toContain("<strong>粗体</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<code>代码</code>");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain("<hr>");
    expect(html).toContain("record-inline-math");
  });

  it("prefers Markdown source when both clipboard text formats contain markers", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p></p>" onChange={onChange} />);

    fireEvent.paste(document.querySelector(".rich-editor")!, {
      clipboardData: {
        getData: (type: string) => type === "text/markdown" ? "## Markdown source" : "**Plain source**",
        items: [],
      },
    });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h2>Markdown source</h2>"));
    expect(onChange.mock.calls.at(-1)?.[0]).not.toContain("Plain source");
  });

  it("leaves ordinary plain text unchanged when it has no Markdown markers", () => {
    const onChange = vi.fn();
    let editorRef: Editor | undefined;
    render(
      <RichTextEditor
        value="<p></p>"
        onChange={onChange}
        renderInsertTools={(editor) => {
          editorRef = editor;
          return null;
        }}
      />,
    );

    fireEvent.paste(document.querySelector(".rich-editor")!, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "普通文本 1 + 1 = 2" : "",
        items: [],
      },
    });

    expect(editorRef?.getHTML()).toBe("<p>普通文本 1 + 1 = 2</p>");
    expect(editorRef?.getHTML()).not.toContain("<h1>");
    expect(editorRef?.getHTML()).not.toContain("record-inline-math");
  });

  it("parses Markdown from the native Android clipboard when DOM data is empty", async () => {
    const onChange = vi.fn();
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockResolvedValue("# Android Markdown\n\n**粗体**和$x^2$");

    try {
      render(<RichTextEditor value="<p></p>" onChange={onChange} />);
      fireEvent.paste(document.querySelector(".rich-editor")!, {
        clipboardData: {
          getData: () => "",
          items: [],
        },
      });

      await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h1>Android Markdown</h1>"));
      expect(onChange.mock.calls.at(-1)?.[0]).toContain("record-inline-math");
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it("converts an Android beforeinput paste when no paste event is emitted", async () => {
    const onChange = vi.fn();
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockResolvedValue(androidMarkdownSample);

    try {
      render(<RichTextEditor value="<p></p>" onChange={onChange} />);
      const editor = document.querySelector(".rich-editor")!;
      const event = nativeInputEvent("beforeinput", "insertFromPaste");
      fireEvent(editor, event);

      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h3>整体规律总结</h3>"));
      const html = onChange.mock.calls.at(-1)?.[0] ?? "";
      expect(html).toContain("<hr>");
      expect(html).toContain("<ul>");
      expect(html).toContain("<strong>破折号插入</strong>");
      expect(html).not.toContain("### 整体规律总结");
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it("uses the input fallback when Android commits text despite a canceled beforeinput", async () => {
    const onChange = vi.fn();
    let editorRef: Editor | undefined;
    let resolveClipboard: ((value: string) => void) | undefined;
    const clipboardPromise = new Promise<string>((resolve) => {
      resolveClipboard = resolve;
    });
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockReturnValue(clipboardPromise);

    try {
      render(
        <RichTextEditor
          value="<p></p>"
          onChange={onChange}
          renderInsertTools={(editor) => {
            editorRef = editor;
            return null;
          }}
        />,
      );
      await waitFor(() => expect(editorRef).toBeDefined());
      const editor = document.querySelector(".rich-editor")!;
      fireEvent(editor, nativeInputEvent("beforeinput", "insertFromPaste"));
      act(() => {
        editorRef?.commands.insertContent(androidMarkdownSample);
      });
      fireEvent(editor, nativeInputEvent("input", "insertFromPaste"));
      resolveClipboard?.(androidMarkdownSample);

      await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h3>整体规律总结</h3>"));
      const html = onChange.mock.calls.at(-1)?.[0] ?? "";
      expect(html).toContain("<hr>");
      expect(html).not.toContain("### 整体规律总结");
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it("replaces raw Android input with Markdown when an IME omits the paste event", async () => {
    const onChange = vi.fn();
    let editorRef: Editor | undefined;
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockResolvedValue(androidMarkdownSample);

    try {
      render(
        <RichTextEditor
          value="<p></p>"
          onChange={onChange}
          renderInsertTools={(editor) => {
            editorRef = editor;
            return null;
          }}
        />,
      );
      await waitFor(() => expect(editorRef).toBeDefined());
      const editor = document.querySelector(".rich-editor")!;
      fireEvent(editor, nativeInputEvent("beforeinput", "insertText"));
      act(() => {
        editorRef?.commands.insertContent(androidMarkdownSample);
      });
      fireEvent(editor, nativeInputEvent("input", "insertText"));

      await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h3>整体规律总结</h3>"));
      const html = onChange.mock.calls.at(-1)?.[0] ?? "";
      expect(html).toContain("<hr>");
      expect(html).toContain("<ul>");
      expect(html).toContain("<strong>名词短语同位语</strong>");
      expect(html).not.toContain("### 整体规律总结");
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it("coalesces segmented Android IME commits before parsing Markdown", async () => {
    const onChange = vi.fn();
    let editorRef: Editor | undefined;
    const chunks = [
      "---\r\n\r\n### 整体规律总结\r\n\r\n",
      "- **破折号插入**：主语后的同位语。\r\n",
      "  - **被动不定式**：need **to be** encouraged",
    ];
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockResolvedValue(chunks.join(""));

    try {
      render(
        <RichTextEditor
          value="<p></p>"
          onChange={onChange}
          renderInsertTools={(editor) => {
            editorRef = editor;
            return null;
          }}
        />,
      );
      await waitFor(() => expect(editorRef).toBeDefined());
      const editor = document.querySelector(".rich-editor")!;
      for (const chunk of chunks) {
        fireEvent(editor, nativeInputEvent("beforeinput", "insertText"));
        act(() => {
          editorRef?.commands.insertContent(chunk);
        });
        fireEvent(editor, nativeInputEvent("input", "insertText"));
      }

      await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h3>整体规律总结</h3>"));
      const html = onChange.mock.calls.at(-1)?.[0] ?? "";
      expect(html).toContain("<hr>");
      expect(html).toContain("<ul>");
      expect(html).toContain("<strong>破折号插入</strong>");
      expect(html).not.toContain("### 整体规律总结");
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it("waits for paced Android IME chunks when the first chunk has no Markdown marker", async () => {
    const onChange = vi.fn();
    let editorRef: Editor | undefined;
    const chunks = [
      "先插入一段普通说明文字。\r\n\r\n",
      "### 后续标题\r\n\r\n- **第一项**\r\n",
      "  - **第二项**",
    ];
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockResolvedValue(chunks.join(""));

    try {
      render(
        <RichTextEditor
          value="<p></p>"
          onChange={onChange}
          renderInsertTools={(editor) => {
            editorRef = editor;
            return null;
          }}
        />,
      );
      await waitFor(() => expect(editorRef).toBeDefined());
      const editor = document.querySelector(".rich-editor")!;
      for (const chunk of chunks) {
        fireEvent(editor, nativeInputEvent("beforeinput", "insertText"));
        act(() => {
          editorRef?.commands.insertContent(chunk);
        });
        fireEvent(editor, nativeInputEvent("input", "insertText"));
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 170));
        });
      }

      await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h3>后续标题</h3>"));
      const html = onChange.mock.calls.at(-1)?.[0] ?? "";
      expect(html).toContain("<p>先插入一段普通说明文字。</p>");
      expect(html).toContain("<ul>");
      expect(html).toContain("<strong>第一项</strong>");
      expect(html).toContain("<strong>第二项</strong>");
      expect(html).not.toContain("### 后续标题");
      expect(readClipboardTextFallback).toHaveBeenCalledTimes(1);
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it("keeps raw Android IME text when a later chunk is not a clipboard prefix", async () => {
    let editorRef: Editor | undefined;
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockResolvedValue("普通开头\r\n\r\n### 正确标题");

    try {
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
      const editor = document.querySelector(".rich-editor")!;
      for (const chunk of ["普通开头\r\n\r\n", "### 错误标题"]) {
        fireEvent(editor, nativeInputEvent("beforeinput", "insertText"));
        act(() => {
          editorRef?.commands.insertContent(chunk);
        });
        fireEvent(editor, nativeInputEvent("input", "insertText"));
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 170));
        });
      }

      await waitFor(() => expect(editorRef?.getHTML()).toContain("### 错误标题"));
      expect(editorRef?.getHTML()).not.toContain("<h3>正确标题</h3>");
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it("keeps incomplete Android IME input after the two-second session expires", async () => {
    let editorRef: Editor | undefined;
    vi.useFakeTimers();
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockReturnValue(new Promise(() => {}));

    try {
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
      const editor = document.querySelector(".rich-editor")!;
      fireEvent(editor, nativeInputEvent("beforeinput", "insertText"));
      act(() => {
        editorRef?.commands.insertContent("尚未完成的粘贴内容");
      });
      fireEvent(editor, nativeInputEvent("input", "insertText"));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(editorRef?.getHTML()).toContain("尚未完成的粘贴内容");
    } finally {
      vi.useRealTimers();
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it.each([3, 5, 7])("renders Android IME Markdown when the cursor lands %i characters before the end", async (offset) => {
    const onChange = vi.fn();
    let editorRef: Editor | undefined;
    const source = [
      "---",
      "",
      "### 异常选区标题",
      "",
      "> **引用粗体**",
      "",
      "- 列表项",
    ].join("\r\n");
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockResolvedValue(source);

    try {
      render(
        <RichTextEditor
          value="<p></p>"
          onChange={onChange}
          renderInsertTools={(editor) => {
            editorRef = editor;
            return null;
          }}
        />,
      );
      await waitFor(() => expect(editorRef).toBeDefined());
      const editor = document.querySelector(".rich-editor")!;
      fireEvent(editor, nativeInputEvent("beforeinput", "insertText"));
      act(() => {
        editorRef?.commands.insertContent(source);
        editorRef?.commands.setTextSelection(editorRef!.state.doc.content.size - offset);
      });
      fireEvent(editor, nativeInputEvent("input", "insertText"));

      await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h3>异常选区标题</h3>"));
      const html = onChange.mock.calls.at(-1)?.[0] ?? "";
      expect(html).toContain("<hr>");
      expect(html).toContain("<blockquote><p><strong>引用粗体</strong></p></blockquote>");
      expect(html).toContain("<ul>");
      expect(html).not.toContain("### 异常选区标题");
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it("uses the clipboard Markdown source when an Android IME inserts extra empty lines", async () => {
    const onChange = vi.fn();
    let editorRef: Editor | undefined;
    const source = ["### 标题", "", "- **第一项**", "- 第二项"].join("\r\n");
    const committedText = ["### 标题", "", "", "", "- **第一项**", "", "- 第二项"].join("\r\n");
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockResolvedValue(source);

    try {
      render(
        <RichTextEditor
          value="<p></p>"
          onChange={onChange}
          renderInsertTools={(editor) => {
            editorRef = editor;
            return null;
          }}
        />,
      );
      await waitFor(() => expect(editorRef).toBeDefined());
      const editor = document.querySelector(".rich-editor")!;
      fireEvent(editor, nativeInputEvent("beforeinput", "insertText"));
      act(() => {
        editorRef?.commands.insertContent(committedText);
      });
      fireEvent(editor, nativeInputEvent("input", "insertText"));

      await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h3>标题</h3>"));
      const html = onChange.mock.calls.at(-1)?.[0] ?? "";
      expect(html).toContain("<ul>");
      expect(html).toContain("<strong>第一项</strong>");
      expect(html).not.toContain("<p></p>");
      expect(html).not.toContain("### 标题");
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it.each([
    ["pointer", (editor: Element) => fireEvent.pointerDown(editor)],
    ["navigation key", (editor: Element) => fireEvent.keyDown(editor, { key: "ArrowLeft" })],
  ])("keeps raw Android IME text after a user %s cancels the session", async (_kind, cancelSession) => {
    let editorRef: Editor | undefined;
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockResolvedValue("**候选文本**");

    try {
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
      const editor = document.querySelector(".rich-editor")!;
      fireEvent(editor, nativeInputEvent("beforeinput", "insertText"));
      act(() => {
        editorRef?.commands.insertContent("**候选文本**");
      });
      fireEvent(editor, nativeInputEvent("input", "insertText"));
      cancelSession(editor);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 170));
      });

      expect(editorRef?.getHTML()).toContain("**候选文本**");
      expect(editorRef?.getHTML()).not.toContain("<strong>候选文本</strong>");
      expect(readClipboardTextFallback).not.toHaveBeenCalled();
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it("keeps raw Android input when it does not match the native clipboard", async () => {
    let editorRef: Editor | undefined;
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(readClipboardTextFallback).mockResolvedValue("## 剪贴板内容");

    try {
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
      const editor = document.querySelector(".rich-editor")!;
      fireEvent(editor, nativeInputEvent("beforeinput", "insertText"));
      act(() => {
        editorRef?.commands.insertContent("## 手工输入内容");
      });
      fireEvent(editor, nativeInputEvent("input", "insertText"));

      await waitFor(() => expect(editorRef?.getHTML()).toContain("## 手工输入内容"));
      expect(editorRef?.getHTML()).not.toContain("<h2>");
    } finally {
      vi.mocked(isNativePlatform).mockReturnValue(false);
      vi.mocked(readClipboardTextFallback).mockReset();
    }
  });

  it("falls back without parsing unsupported or oversized Markdown", () => {
    const onChange = vi.fn();
    let editorRef: Editor | undefined;
    render(
      <RichTextEditor
        value="<p></p>"
        onChange={onChange}
        renderInsertTools={(editor) => {
          editorRef = editor;
          return null;
        }}
      />,
    );
    const editor = document.querySelector(".rich-editor")!;
    const paste = (text: string) => fireEvent.paste(editor, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? text : "", items: [] },
    });

    paste("# 标题\n~~不支持删除线~~");
    paste(`# 超大内容\n${"x".repeat(262144)}`);

    const html = editorRef?.getHTML() ?? "";
    expect(html).toContain("# 标题");
    expect(html).toContain("# 超大内容");
    expect(html).not.toContain("<h1>");
    expect(html).not.toContain("record-inline-math");
  });

  it("keeps text when an image is pasted with Markdown that cannot be parsed", async () => {
    const onChange = vi.fn();
    const onPasteImage = vi.fn().mockResolvedValue({ id: "asset-1", kind: "image", title: "截图" });
    let editorRef: Editor | undefined;
    render(
      <RichTextEditor
        value="<p></p>"
        onChange={onChange}
        onPasteImage={onPasteImage}
        renderInsertTools={(editor) => {
          editorRef = editor;
          return null;
        }}
      />,
    );

    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    fireEvent.paste(document.querySelector(".rich-editor")!, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "# 保留原文\n~~不支持删除线~~" : "",
        items: [{ kind: "file", type: "image/png", getAsFile: () => image }],
      },
    });

    await waitFor(() => expect(editorRef?.getHTML()).toContain("# 保留原文"));
    await waitFor(() => expect(editorRef?.getHTML()).toContain("record-asset"));
    expect(onPasteImage).toHaveBeenCalledWith(image);
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

  it("converts Markdown after an Android-style composition commit", async () => {
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
      editorRef?.commands.insertContent("中文**粗体**以及*斜体*和$\\frac{\\sin(x^2)}{x^2}$");
    });
    fireEvent.input(document.querySelector(".rich-editor")!);

    await waitFor(() => expect(editorRef?.getHTML()).toContain("中文<strong>粗体</strong>以及<em>斜体</em>和"));
    expect(editorRef?.getHTML()).toContain("record-inline-math");
  });

  it("keeps pasted inline formulas inside their surrounding paragraph", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p></p>" onChange={onChange} />);

    fireEvent.paste(document.querySelector(".rich-editor")!, {
      clipboardData: {
        getData: (type: string) => type === "text/plain"
          ? "所以，式子就理所当然地变成了：\n$= \\lim_{x \\to 0^+} \\frac{-x^4}{ab x^{b-1}}$"
          : "",
        items: [],
      },
    });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("record-inline-math"));
    const html = onChange.mock.calls.at(-1)?.[0] ?? "";
    expect(html).toContain("<p>所以，式子就理所当然地变成了：");
    expect(html).toContain("<record-inline-math");
    expect(html).toContain('data-latex="= \\lim_{x \\to 0^+} \\frac{-x^4}{ab x^{b-1}}"');
    expect(html).not.toContain("</p><p><record-inline-math");
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

  it("does not convert formulas inside a double-backtick code span", async () => {
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
    act(() => editorRef?.commands.insertContent("``$x$``"));
    fireEvent.input(document.querySelector(".rich-editor")!);

    await waitFor(() => expect(editorRef?.getHTML()).toContain("``$x$``"));
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
