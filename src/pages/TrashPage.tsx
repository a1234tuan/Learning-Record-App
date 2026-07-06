import { RotateCcw, Trash2 } from "lucide-react";

import type { RecordBlock } from "../types";
import { formatChineseDate } from "../lib/date";
import { ActionButton, PageHeader } from "../components/ui";

const RETENTION_DAYS = 30;

const remainingDays = (record: RecordBlock): number => {
  if (!record.deletedAt) {
    return RETENTION_DAYS;
  }
  const deletedAt = new Date(record.deletedAt).getTime();
  const elapsedDays = Math.floor((Date.now() - deletedAt) / (24 * 60 * 60 * 1000));
  return Math.max(0, RETENTION_DAYS - elapsedDays);
};

interface TrashPageProps {
  records: RecordBlock[];
  onRestore: (record: RecordBlock) => Promise<void> | void;
  onPermanentDelete: (record: RecordBlock) => Promise<void> | void;
  onClearTrash: () => Promise<void> | void;
  onPurgeExpired: () => Promise<void> | void;
}

export const TrashPage = ({
  records,
  onRestore,
  onPermanentDelete,
  onClearTrash,
  onPurgeExpired,
}: TrashPageProps) => {
  const sortedRecords = [...records].sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

  return (
    <main className="page trash-page">
      <PageHeader
        eyebrow="Trash"
        title="回收站"
        subtitle="删除的记录会在这里保留 30 天，过期后自动永久清理。"
        actions={
          <div className="record-action-row">
            <ActionButton variant="ghost" onClick={() => void onPurgeExpired()}>
              清理过期
            </ActionButton>
            <ActionButton variant="danger" onClick={() => void onClearTrash()} disabled={sortedRecords.length === 0}>
              <Trash2 size={16} />
              清空
            </ActionButton>
          </div>
        }
      />

      <section className="trash-list">
        {sortedRecords.length === 0 ? (
          <div className="empty-state">
            <Trash2 size={24} />
            <h2>回收站是空的。</h2>
            <p>删除记录后，它会先在这里停留 30 天。</p>
          </div>
        ) : (
          sortedRecords.map((record) => (
            <article key={record.id} className="trash-card">
              <div className="trash-card-main">
                <strong>{record.title}</strong>
                <small>
                  {record.subject} · {formatChineseDate(record.date)}
                </small>
                <small>
                  删除于 {record.deletedAt ? new Date(record.deletedAt).toLocaleString() : "未知时间"} · 还剩 {remainingDays(record)} 天
                </small>
              </div>
              <div className="trash-card-actions">
                <button type="button" className="secondary-button" onClick={() => void onRestore(record)}>
                  <RotateCcw size={16} />
                  恢复
                </button>
                <button type="button" className="icon-button danger" onClick={() => void onPermanentDelete(record)} aria-label="永久删除">
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
};
