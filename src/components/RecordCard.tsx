import type { RecordBlock } from "../types";

interface RecordCardProps {
  record: RecordBlock;
  onOpen: (record: RecordBlock) => void;
}

export const RecordCard = ({ record, onOpen }: RecordCardProps) => (
  <button type="button" className="record-card" onClick={() => onOpen(record)}>
    <div>
      <strong>{record.title}</strong>
      <small>{record.date} / {record.assets.length} 个资源 / {record.formulas.length} 个公式</small>
    </div>
    <span>{record.subject}</span>
  </button>
);
