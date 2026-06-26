import { ChevronDown, Rows3, SquareStack, StickyNote, Workflow } from "lucide-react";
import { useState } from "react";

import type { StructureBlockKind } from "../lib/recordStructureBlocks";

interface StructureInsertMenuProps {
  onInsert: (kind: StructureBlockKind) => void;
  compact?: boolean;
}

const options: Array<{ kind: StructureBlockKind; label: string; description: string; icon: typeof Workflow }> = [
  { kind: "diagram", label: "结构图", description: "层级、主链、分叉", icon: Workflow },
  { kind: "comparison", label: "对照表", description: "概念、作用、类比、易错点", icon: Rows3 },
  { kind: "sticky", label: "便签板", description: "脑暴、疑问、例子", icon: StickyNote },
  { kind: "collapse", label: "折叠块", description: "先回忆，后展开验证", icon: SquareStack },
];

export const StructureInsertMenu = ({ onInsert, compact = false }: StructureInsertMenuProps) => {
  const [open, setOpen] = useState(false);

  const insert = (kind: StructureBlockKind) => {
    onInsert(kind);
    setOpen(false);
  };

  return (
    <span className={`structure-insert-menu${open ? " open" : ""}${compact ? " compact" : ""}`}>
      <button type="button" className="structure-insert-trigger" title="结构块" onClick={() => setOpen((value) => !value)}>
        <Workflow size={16} />
        {!compact && <span>结构</span>}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="structure-insert-popover">
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <button key={option.kind} type="button" onClick={() => insert(option.kind)}>
                <Icon size={17} />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
};
