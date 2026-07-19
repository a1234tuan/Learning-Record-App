import { useEffect, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";

import type { Asset, Block, DayEntry, SearchResult } from "../types";
import { searchAllAsync } from "../lib/search";

interface SearchPageProps {
  entries: DayEntry[];
  blocks: Block[];
  assets: Asset[];
  query: string;
  onQueryChange: (query: string) => void;
  onBack?: () => void;
  onOpenRecord?: (recordId: string, assetId?: string) => void;
}

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_RESULT_LIMIT = 200;

export const SearchPage = ({ entries, blocks, assets, query, onQueryChange, onBack, onOpenRecord }: SearchPageProps) => {
  const [deferredQuery, setDeferredQuery] = useState(query);
  const [rawResults, setRawResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setDeferredQuery("");
      return undefined;
    }
    const timer = window.setTimeout(() => setDeferredQuery(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    if (!deferredQuery.trim()) {
      setRawResults([]);
      setSearching(false);
      return () => controller.abort();
    }
    setSearching(true);
    void searchAllAsync(deferredQuery, entries, blocks, assets, SEARCH_RESULT_LIMIT + 1, controller.signal)
      .then((nextResults) => {
        if (!controller.signal.aborted) {
          setRawResults(nextResults);
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        throw error;
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      });
    return () => controller.abort();
  }, [assets, blocks, deferredQuery, entries]);

  const results = rawResults.slice(0, SEARCH_RESULT_LIMIT);
  const hasMoreResults = rawResults.length > SEARCH_RESULT_LIMIT;

  return (
    <main className="page search-page">
      <section className="section-header">
        <div>
          <p className="eyebrow">Search</p>
          <h1>全文搜索</h1>
        </div>
        {onBack && (
          <button type="button" className="secondary-button" onClick={onBack}>
            <ArrowLeft size={18} />
            返回
          </button>
        )}
      </section>
      <label className="search-box">
        <Search size={20} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索中值定理、页面置换、录音标题、PDF 文件名..."
        />
      </label>
      <section className="search-results">
        {searching && <p className="status-message">正在搜索…</p>}
        {hasMoreResults && (
          <p className="status-message">结果较多，仅显示前 {SEARCH_RESULT_LIMIT} 条，请缩小关键词。</p>
        )}
        {results.map((result) => (
          <button
            key={`${result.type}-${result.id}`}
            type="button"
            className="search-result"
            onClick={() => {
              if (result.recordId) {
                onOpenRecord?.(result.recordId, result.assetId);
              }
            }}
          >
            <span>{result.type}</span>
            <h3>{result.title}</h3>
            <p>{result.excerpt}</p>
            <div className="tag-row">
              {result.matchSource === "assetOcr" && <small>图片文字</small>}
              {result.matchSource === "assetMeta" && <small>资源标题</small>}
              {result.tags.map((tag) => (
                <small key={tag}>#{tag}</small>
              ))}
            </div>
          </button>
        ))}
        {query && results.length === 0 && (
          <div className="empty-state">
            <h2>没搜到。</h2>
            <p>换一个更短的关键词试试。</p>
          </div>
        )}
      </section>
    </main>
  );
};
