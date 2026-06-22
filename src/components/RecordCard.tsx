import { FileText, Star } from "lucide-react";

import type { RecordBlock } from "../types";

interface RecordCardProps {
  record: RecordBlock;
  onOpen: (record: RecordBlock) => void;
  onToggleFavorite?: (favorite: boolean) => void;
}

export const RecordCard = ({ record, onOpen, onToggleFavorite }: RecordCardProps) => {
  const assetText = record.assets.length > 0 ? `${record.assets.length} 个资源` : "无资源";
  const formulaText = record.formulas.length > 0 ? `${record.formulas.length} 个公式` : "无公式";

  return (
    <article className="record-card">
      <button type="button" className="record-card-main" onClick={() => onOpen(record)}>
        <span className="record-card-icon">
          <FileText size={18} />
        </span>
        <div>
          <strong>{record.title}</strong>
          <small>
            {record.date} · {assetText} · {formulaText}
          </small>
        </div>
        <span>{record.subject}</span>
      </button>
      {onToggleFavorite && (
        <button
          type="button"
          className={`record-favorite-button ${record.favorite ? "active" : ""}`}
          onClick={() => onToggleFavorite(!record.favorite)}
          aria-label={record.favorite ? "取消收藏" : "收藏记录"}
        >
          <Star size={17} fill={record.favorite ? "currentColor" : "none"} />
        </button>
      )}
    </article>
  );
};
