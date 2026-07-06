import { subDays } from "date-fns";

import type { Block } from "../types";
import { toISODate } from "../lib/date";

interface HeatmapProps {
  blocks: Block[];
}

export const Heatmap = ({ blocks }: HeatmapProps) => {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    counts.set(block.date, (counts.get(block.date) ?? 0) + 1);
  }

  const days = Array.from({ length: 112 }, (_, index) => toISODate(subDays(new Date(), 111 - index)));

  return (
    <div className="heatmap" aria-label="打卡热力图">
      {days.map((date) => {
        const count = counts.get(date) ?? 0;
        const level = count === 0 ? 0 : count < 2 ? 1 : count < 4 ? 2 : count < 7 ? 3 : 4;
        return <span key={date} title={`${date}: ${count} 条记录`} data-level={level} />;
      })}
    </div>
  );
};
