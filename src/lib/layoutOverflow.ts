export interface OverflowCandidate {
  selector: string;
  scrollWidth: number;
  clientWidth: number;
  allowed: boolean;
}

interface OverflowOptions {
  allowedSelectors?: string[];
}

const selectorFor = (element: Element): string => {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList).slice(0, 4).map((className) => `.${className}`).join("");
  return `${tag}${id}${classes}`;
};

const matchesAnySelector = (element: Element, selectors: string[]): boolean =>
  selectors.some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });

export const findHorizontalOverflowCandidates = (root: Element, options: OverflowOptions = {}): OverflowCandidate[] =>
  Array.from(root.querySelectorAll("*"))
    .map((element) => ({
      selector: selectorFor(element),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      allowed: matchesAnySelector(element, options.allowedSelectors ?? []),
    }))
    .filter((item) => item.scrollWidth > item.clientWidth + 1);
