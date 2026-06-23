import { useMemo } from "react";
import { Search } from "lucide-react";

import type { Asset, Block, DayEntry } from "../types";
import { searchAll } from "../lib/search";

interface SearchPageProps {
  entries: DayEntry[];
  blocks: Block[];
  assets: Asset[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpenRecord?: (recordId: string, assetId?: string) => void;
}

export const SearchPage = ({ entries, blocks, assets, query, onQueryChange, onOpenRecord }: SearchPageProps) => {
  const results = useMemo(() => searchAll(query, entries, blocks, assets), [assets, blocks, entries, query]);

  return (
    <main className="page search-page">
      <section className="section-header">
        <div>
          <p className="eyebrow">Search</p>
          <h1>全文搜索</h1>
        </div>
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
