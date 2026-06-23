import { useEffect } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import cpp from "highlight.js/lib/languages/cpp";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import { RecordAssetNode, RecordFormulaNode } from "./RecordEditorNodes";

const lowlight = createLowlight();
lowlight.register("cpp", cpp);
lowlight.register("javascript", javascript);
lowlight.register("python", python);

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  renderInsertTools?: (editor: Editor) => React.ReactNode;
  readOnly?: boolean;
  highlightedAssetId?: string;
  onAssetChanged?: () => void;
}

export const RichTextEditor = ({
  value,
  onChange,
  placeholder,
  renderInsertTools,
  readOnly = false,
  highlightedAssetId,
  onAssetChanged,
}: RichTextEditorProps) => {
  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
      RecordAssetNode.configure({ highlightedAssetId, onAssetChanged }),
      RecordFormulaNode,
      Placeholder.configure({
        placeholder: placeholder ?? "写下今天的学习、卡点、截图、公式或一点心得...",
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "rich-editor",
        draggable: "false",
      },
      handleDOMEvents: {
        dragstart: (_view, event) => {
          event.preventDefault();
          return true;
        },
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) {
    return null;
  }

  return (
    <div className={readOnly ? "editor-shell read-only" : "editor-shell"}>
      {!readOnly && (
        <div className="editor-toolbar" aria-label="编辑工具栏">
          <button type="button" title="加粗" onClick={() => editor.chain().focus().toggleBold().run()}>
            B
          </button>
          <button type="button" title="斜体" onClick={() => editor.chain().focus().toggleItalic().run()}>
            I
          </button>
          <button type="button" title="标题" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            H
          </button>
          <button type="button" title="列表" onClick={() => editor.chain().focus().toggleBulletList().run()}>
            •
          </button>
          <button type="button" title="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            “”
          </button>
          <button type="button" title="代码" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            &lt;/&gt;
          </button>
          {renderInsertTools?.(editor)}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
};
