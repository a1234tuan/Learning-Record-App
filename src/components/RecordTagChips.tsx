import type { CSSProperties } from "react";

import type { Subject } from "../types";
import { normalizeRecordTags, stableRecordTagHue } from "../lib/recordTags";

interface RecordTagChipsProps {
  subject: Subject;
  tags: readonly string[] | undefined;
  className?: string;
}

export const recordTagStyle = (subject: Subject, tag: string): CSSProperties => ({
  "--record-tag-hue": stableRecordTagHue(subject, tag),
} as CSSProperties);

export const RecordTagChips = ({ subject, tags, className = "" }: RecordTagChipsProps) => {
  const normalizedTags = normalizeRecordTags(tags);
  if (normalizedTags.length === 0) {
    return null;
  }

  return (
    <div className={`record-tag-chips ${className}`.trim()} aria-label={`日志标签：${normalizedTags.join("、")}`}>
      {normalizedTags.map((tag) => (
        <span key={tag} className="record-tag-chip" style={recordTagStyle(subject, tag)}>
          {tag}
        </span>
      ))}
    </div>
  );
};
