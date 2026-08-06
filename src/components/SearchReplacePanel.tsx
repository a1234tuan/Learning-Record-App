import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Command } from "prosemirror-state";
import {
  SearchQuery,
  findNext,
  findPrev,
  getMatchHighlights,
  replaceAll,
  replaceNext,
  setSearchState,
} from "prosemirror-search";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, X } from "lucide-react";

interface SearchReplacePanelProps {
  editor: Editor;
  readOnly: boolean;
  onClose: () => void;
}

export const SearchReplacePanel = ({ editor, readOnly, onClose }: SearchReplacePanelProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matchInfo, setMatchInfo] = useState({ current: 0, total: 0 });
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const query = useMemo(
    () => new SearchQuery({ search: searchTerm, caseSensitive, regexp: useRegex, replace: replaceTerm }),
    [searchTerm, caseSensitive, useRegex, replaceTerm],
  );

  useEffect(() => {
    if (editor.isDestroyed) {
      return;
    }
    editor.view.dispatch(setSearchState(editor.state.tr, query));
  }, [editor, query]);

  useEffect(() => {
    const updateMatchInfo = () => {
      if (editor.isDestroyed) {
        return;
      }
      const matches = getMatchHighlights(editor.state)
        .find()
        .slice()
        .sort((a, b) => a.from - b.from);
      const { from, to } = editor.state.selection;
      const currentIndex = matches.findIndex((match) => match.from === from && match.to === to);
      setMatchInfo({ current: currentIndex + 1, total: matches.length });
    };
    updateMatchInfo();
    editor.on("transaction", updateMatchInfo);
    return () => {
      editor.off("transaction", updateMatchInfo);
    };
  }, [editor]);

  useEffect(() => () => {
    if (!editor.isDestroyed) {
      editor.view.dispatch(setSearchState(editor.state.tr, new SearchQuery({ search: "" })));
    }
  }, [editor]);

  const runCommand = (command: Command) => {
    if (editor.isDestroyed) {
      return;
    }
    command(editor.state, editor.view.dispatch, editor.view);
    editor.view.focus();
  };

  const hasRegexError = useRegex && searchTerm.length > 0 && !query.valid;
  const hasMatches = matchInfo.total > 0;

  return (
    <div className="search-replace-panel" role="search" aria-label="查找替换">
      <div className="search-replace-row">
        <input
          ref={searchInputRef}
          type="text"
          className={hasRegexError ? "search-replace-input invalid" : "search-replace-input"}
          placeholder="查找"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              runCommand(event.shiftKey ? findPrev : findNext);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          aria-label="查找内容"
          aria-invalid={hasRegexError}
        />
        <span className="search-replace-count">
          {searchTerm ? `${hasMatches ? matchInfo.current : 0}/${matchInfo.total}` : ""}
        </span>
        <button
          type="button"
          className={caseSensitive ? "icon-button active" : "icon-button"}
          title="大小写敏感"
          aria-label="大小写敏感"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((value) => !value)}
        >
          <CaseSensitive size={16} />
        </button>
        <button
          type="button"
          className={useRegex ? "icon-button active" : "icon-button"}
          title="正则表达式"
          aria-label="正则表达式"
          aria-pressed={useRegex}
          onClick={() => setUseRegex((value) => !value)}
        >
          <Regex size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="上一个（Shift+Enter）"
          aria-label="上一个匹配"
          disabled={!hasMatches}
          onClick={() => runCommand(findPrev)}
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="下一个（Enter）"
          aria-label="下一个匹配"
          disabled={!hasMatches}
          onClick={() => runCommand(findNext)}
        >
          <ChevronDown size={16} />
        </button>
        <button type="button" className="icon-button" title="关闭（Esc）" aria-label="关闭查找替换" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {!readOnly && (
        <div className="search-replace-row">
          <input
            type="text"
            className="search-replace-input"
            placeholder="替换为"
            value={replaceTerm}
            onChange={(event) => setReplaceTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                runCommand(replaceNext);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            aria-label="替换为"
          />
          <button
            type="button"
            className="secondary-button search-replace-action"
            disabled={!hasMatches}
            onClick={() => runCommand(replaceNext)}
          >
            替换
          </button>
          <button
            type="button"
            className="secondary-button search-replace-action"
            disabled={!hasMatches}
            onClick={() => runCommand(replaceAll)}
          >
            全部替换
          </button>
        </div>
      )}
    </div>
  );
};
