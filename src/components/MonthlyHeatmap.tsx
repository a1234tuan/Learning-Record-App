import { addMonths, format, isSameMonth, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { Block } from "../types";
import { monthCalendarDays } from "../lib/date";

interface MonthlyHeatmapProps {
  month: Date;
  blocks: Block[];
  selectedDate?: string;
  onMonthChange: (month: Date) => void;
  onSelectDate: (date: string) => void;
}

export const heatmapLevel = (count: number): 0 | 1 | 2 | 3 => {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
};

export const MonthlyHeatmap = ({ month, blocks, selectedDate, onMonthChange, onSelectDate }: MonthlyHeatmapProps) => {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (block.type === "record") {
      counts.set(block.date, (counts.get(block.date) ?? 0) + 1);
    }
  }

  return (
    <section className="monthly-heatmap-panel">
      <header>
        <button type="button" className="icon-button" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="上个月">
          <ChevronLeft size={18} />
        </button>
        <div>
          <p className="eyebrow">Activity</p>
          <strong>{format(month, "yyyy 年 M 月")}</strong>
        </div>
        <button type="button" className="icon-button" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="下个月">
          <ChevronRight size={18} />
        </button>
      </header>
      <div className="month-weekdays">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="month-grid">
        {monthCalendarDays(month).map((date) => {
          const count = counts.get(date) ?? 0;
          const sameMonth = isSameMonth(parseISO(date), month);
          return (
            <button
              key={date}
              type="button"
              className={selectedDate === date ? "selected" : ""}
              data-level={heatmapLevel(count)}
              data-muted={!sameMonth}
              title={`${date}: ${count} 条记录`}
              onClick={() => onSelectDate(date)}
            >
              {Number(date.slice(-2))}
            </button>
          );
        })}
      </div>
    </section>
  );
};
