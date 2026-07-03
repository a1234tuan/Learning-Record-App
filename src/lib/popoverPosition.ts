export interface PopoverPosition {
  top: number;
  left: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

interface ViewportSize {
  width: number;
  height: number;
}

interface PopoverSize {
  width: number;
  height: number;
  align?: "left" | "right";
}

const GAP = 8;
const EDGE_PADDING = 8;

export const computePopoverPosition = (
  trigger: DOMRect,
  viewport: ViewportSize,
  popover: PopoverSize,
): PopoverPosition => {
  const spaceBelow = viewport.height - trigger.bottom - GAP - EDGE_PADDING;
  const spaceAbove = trigger.top - GAP - EDGE_PADDING;
  const placement: PopoverPosition["placement"] =
    spaceBelow >= popover.height || spaceBelow >= spaceAbove ? "bottom" : "top";
  const availableHeight = Math.max(120, placement === "bottom" ? spaceBelow : spaceAbove);
  const top = placement === "bottom"
    ? Math.min(trigger.bottom + GAP, viewport.height - EDGE_PADDING - Math.min(popover.height, availableHeight))
    : Math.max(EDGE_PADDING, trigger.top - GAP - Math.min(popover.height, availableHeight));
  const preferredLeft = popover.align === "right" ? trigger.right - popover.width : trigger.left;
  const left = Math.min(
    Math.max(EDGE_PADDING, preferredLeft),
    Math.max(EDGE_PADDING, viewport.width - popover.width - EDGE_PADDING),
  );

  return {
    top,
    left,
    maxHeight: availableHeight,
    placement,
  };
};
