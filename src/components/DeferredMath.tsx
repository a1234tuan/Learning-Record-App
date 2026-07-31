import { useCallback, useEffect, useRef, useState } from "react";
import katex from "katex";
import MarkdownIt from "markdown-it";

import "katex/dist/katex.min.css";

export const KATEX_CACHE_LIMIT = 256;

const katexHtmlCache = new Map<string, string>();
const cellMarkupCache = new Map<string, string>();
const queuedRenders = new Map<number, () => void>();
let renderSequence = 0;
let renderScheduled = false;

const cacheKeyFor = (latex: string, displayMode: boolean): string =>
  `${displayMode ? "block" : "inline"}:${latex}`;

const touchCache = (cache: Map<string, string>, key: string): string | undefined => {
  const cached = cache.get(key);
  if (cached !== undefined) {
    cache.delete(key);
    cache.set(key, cached);
  }
  return cached;
};

const putCache = (cache: Map<string, string>, key: string, value: string, limit: number) => {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
};

const runNextRender = () => {
  renderScheduled = false;
  const next = queuedRenders.entries().next().value as [number, () => void] | undefined;
  if (next) {
    queuedRenders.delete(next[0]);
    next[1]();
  }
  scheduleRender();
};

const scheduleRender = () => {
  if (renderScheduled || queuedRenders.size === 0) {
    return;
  }
  renderScheduled = true;
  if (typeof window === "undefined") {
    queueMicrotask(runNextRender);
    return;
  }
  const idle = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (idle) {
    idle(runNextRender, { timeout: 100 });
    return;
  }
  window.setTimeout(runNextRender, 16);
};

export const enqueueDeferredRender = (render: () => void): (() => void) => {
  const id = ++renderSequence;
  queuedRenders.set(id, render);
  scheduleRender();
  return () => queuedRenders.delete(id);
};

export const renderKaTeX = (latex: string, displayMode: boolean): string => {
  const key = cacheKeyFor(latex, displayMode);
  const cached = touchCache(katexHtmlCache, key);
  if (cached !== undefined) {
    return cached;
  }

  let html = "";
  try {
    html = katex.renderToString(latex || " ", { throwOnError: false, displayMode });
  } catch {
    html = "";
  }
  putCache(katexHtmlCache, key, html, KATEX_CACHE_LIMIT);
  return html;
};

const findUnescapedDollar = (source: string, start: number): number => {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] !== "$" || source[index - 1] === "\\") {
      continue;
    }
    return index;
  }
  return -1;
};

type MathMarkdownState = {
  src: string;
  pos: number;
  line: number;
  lineMax: number;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  getLines: (begin: number, end: number, indent: number, keepLastLF: boolean) => string;
};

const mathInlineRule = (state: MathMarkdownState, silent: boolean): boolean => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 36 || state.src.charCodeAt(start + 1) === 36) {
    return false;
  }
  const end = findUnescapedDollar(state.src, start + 1);
  if (end < 0 || end === start + 1 || state.src.slice(start + 1, end).includes("\n")) {
    return false;
  }
  if (!silent) {
    const token = (state as unknown as {
      push: (type: string, tag: string, nesting: number) => { content: string };
    }).push("math_inline", "math", 0);
    token.content = state.src.slice(start + 1, end);
  }
  state.pos = end + 1;
  return true;
};

const mathBlockRule = (state: MathMarkdownState, startLine: number, endLine: number, silent: boolean): boolean => {
  if (startLine >= state.lineMax) {
    return false;
  }
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const end = state.eMarks[startLine];
  const line = state.src.slice(start, end).trim();
  const singleLineMatch = /^\$\$([\s\S]*?)\$\$$/.exec(line);
  if (singleLineMatch?.[1].trim()) {
    if (!silent) {
      const token = (state as unknown as {
        push: (type: string, tag: string, nesting: number) => { content: string };
      }).push("math_block", "math", 0);
      token.content = singleLineMatch[1].trim();
      state.line = startLine + 1;
    }
    return true;
  }
  if (line !== "$$") {
    return false;
  }
  let nextLine = startLine + 1;
  while (nextLine < endLine) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineEnd = state.eMarks[nextLine];
    if (state.src.slice(lineStart, lineEnd).trim() === "$$") {
      break;
    }
    nextLine += 1;
  }
  if (nextLine >= endLine) {
    return false;
  }
  if (!silent) {
    const token = (state as unknown as {
      push: (type: string, tag: string, nesting: number) => { content: string };
    }).push("math_block", "math", 0);
    token.content = state.getLines(startLine + 1, nextLine, 0, true).trim();
    state.line = nextLine + 1;
  }
  return true;
};

const mathMarkdown = new MarkdownIt({ html: false, breaks: false, linkify: false, typographer: false });
mathMarkdown.disable("image");
mathMarkdown.inline.ruler.before("escape", "math_inline", mathInlineRule as never);
mathMarkdown.block.ruler.before("fence", "math_block", mathBlockRule as never, {
  alt: ["paragraph", "reference", "blockquote", "list"],
});

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

type DeferredFormula = {
  latex: string;
  displayMode: boolean;
};

type CellMarkupTemplate = {
  html: string;
  formulas: DeferredFormula[];
};

type MathMarkdownEnvironment = {
  formulas?: DeferredFormula[];
};

const formulaSlot = (index: number, latex: string): string =>
  `<span data-deferred-math-slot="${index}"><code class="formula-render-pending">${escapeHtml(latex)}</code></span>`;

const renderMathToken = (latex: string, displayMode: boolean, environment: MathMarkdownEnvironment | undefined): string => {
  if (!environment?.formulas) {
    return renderKaTeX(latex, displayMode);
  }
  const slot = environment.formulas.length;
  environment.formulas.push({ latex, displayMode });
  return formulaSlot(slot, latex);
};

mathMarkdown.renderer.rules.math_inline = (tokens, index, _options, environment) =>
  renderMathToken(tokens[index].content, false, environment as MathMarkdownEnvironment);
mathMarkdown.renderer.rules.math_block = (tokens, index, _options, environment) =>
  renderMathToken(tokens[index].content, true, environment as MathMarkdownEnvironment);

const renderPlainCell = (source: string, renderFormula: (latex: string, displayMode: boolean) => string): string => {
  const parts: string[] = [];
  let textStart = 0;
  let index = 0;
  let codeDelimiter = 0;
  const flushText = (end: number) => {
    if (end > textStart) {
      parts.push(escapeHtml(source.slice(textStart, end)));
    }
  };
  while (index < source.length) {
    if (source[index] === "`") {
      let end = index + 1;
      while (source[end] === "`") {
        end += 1;
      }
      const delimiter = end - index;
      if (codeDelimiter === 0) {
        codeDelimiter = delimiter;
      } else if (codeDelimiter === delimiter) {
        codeDelimiter = 0;
      }
      index = end;
      continue;
    }
    if (codeDelimiter > 0 || source[index] !== "$" || source[index - 1] === "\\") {
      index += 1;
      continue;
    }
    const display = source[index + 1] === "$";
    const start = index + (display ? 2 : 1);
    const end = findUnescapedDollar(source, start + (display ? 1 : 0));
    if (end < 0 || (!display && source.slice(start, end).includes("\n"))) {
      index += 1;
      continue;
    }
    const delimiterEnd = display ? end + 2 : end + 1;
    if (display && source[end + 1] !== "$") {
      index += 1;
      continue;
    }
    flushText(index);
    parts.push(renderFormula(source.slice(start, end), display));
    index = delimiterEnd;
    textStart = index;
  }
  flushText(source.length);
  return parts.join("");
};

export const renderCellMarkup = (source: string, markdown: boolean): string => {
  if (!source) {
    return "";
  }
  if (!markdown) {
    return renderPlainCell(source, renderKaTeX);
  }
  const hasBlockFormula = /(^|\n)\s*\$\$/.test(source);
  return hasBlockFormula ? mathMarkdown.render(source) : mathMarkdown.renderInline(source);
};

const createCellMarkupTemplate = (source: string, markdown: boolean): CellMarkupTemplate => {
  const formulas: DeferredFormula[] = [];
  const environment: MathMarkdownEnvironment = { formulas };
  if (!markdown) {
    return {
      html: renderPlainCell(source, (latex, displayMode) => renderMathToken(latex, displayMode, environment)),
      formulas,
    };
  }
  const hasBlockFormula = /(^|\n)\s*\$\$/.test(source);
  return {
    html: hasBlockFormula ? mathMarkdown.render(source, environment) : mathMarkdown.renderInline(source, environment),
    formulas,
  };
};

const cellCacheKey = (source: string, markdown: boolean): string => `${markdown ? "markdown" : "plain"}:${source}`;

export const useDeferredKaTeX = (latex: string, displayMode: boolean, immediate: boolean) => {
  const hostRef = useRef<HTMLElement | null>(null);
  const setHostRef = useCallback((element: HTMLElement | null) => {
    hostRef.current = element;
  }, []);
  const [html, setHtml] = useState<string | undefined>(() => touchCache(katexHtmlCache, cacheKeyFor(latex, displayMode)));

  useEffect(() => {
    const cached = touchCache(katexHtmlCache, cacheKeyFor(latex, displayMode));
    if (cached !== undefined) {
      setHtml(cached);
      return undefined;
    }
    setHtml(undefined);
    let cancelled = false;
    let cancelQueuedRender: (() => void) | undefined;
    const render = () => {
      const rendered = renderKaTeX(latex, displayMode);
      if (!cancelled) {
        setHtml(rendered);
      }
    };
    if (immediate) {
      render();
      return () => {
        cancelled = true;
      };
    }
    const host = hostRef.current;
    if (typeof IntersectionObserver === "undefined" || !host) {
      cancelQueuedRender = enqueueDeferredRender(render);
      return () => {
        cancelled = true;
        cancelQueuedRender?.();
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }
      observer.disconnect();
      cancelQueuedRender = enqueueDeferredRender(render);
    }, { rootMargin: "400px 0px" });
    observer.observe(host);
    return () => {
      cancelled = true;
      observer.disconnect();
      cancelQueuedRender?.();
    };
  }, [displayMode, immediate, latex]);

  return { hostRef: setHostRef, html };
};

export const useDeferredCellMarkup = (source: string, markdown: boolean) => {
  const hostRef = useRef<HTMLElement | null>(null);
  const setHostRef = useCallback((element: HTMLElement | null) => {
    hostRef.current = element;
  }, []);
  const key = cellCacheKey(source, markdown);
  const [html, setHtml] = useState<string | undefined>(() => touchCache(cellMarkupCache, key));

  useEffect(() => {
    const cached = touchCache(cellMarkupCache, key);
    if (cached !== undefined) {
      setHtml(cached);
      return undefined;
    }
    setHtml(undefined);
    let cancelled = false;
    let cancelQueuedRender: (() => void) | undefined;
    const schedule = (render: () => void) => {
      cancelQueuedRender = enqueueDeferredRender(() => {
        cancelQueuedRender = undefined;
        render();
      });
    };
    const render = () => {
      const template = createCellMarkupTemplate(source, markdown);
      if (template.formulas.length === 0) {
        putCache(cellMarkupCache, key, template.html, KATEX_CACHE_LIMIT);
        if (!cancelled) {
          setHtml(template.html);
        }
        return;
      }
      let markup = template.html;
      let formulaIndex = 0;
      const renderNextFormula = () => {
        if (cancelled) {
          return;
        }
        const formula = template.formulas[formulaIndex];
        markup = markup.replace(formulaSlot(formulaIndex, formula.latex), renderKaTeX(formula.latex, formula.displayMode));
        formulaIndex += 1;
        setHtml(markup);
        if (formulaIndex < template.formulas.length) {
          schedule(renderNextFormula);
        } else {
          putCache(cellMarkupCache, key, markup, KATEX_CACHE_LIMIT);
        }
      };
      schedule(renderNextFormula);
    };
    const host = hostRef.current;
    if (typeof IntersectionObserver === "undefined" || !host) {
      schedule(render);
      return () => {
        cancelled = true;
        cancelQueuedRender?.();
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }
      observer.disconnect();
      cancelQueuedRender = enqueueDeferredRender(render);
    }, { rootMargin: "400px 0px" });
    observer.observe(host);
    return () => {
      cancelled = true;
      observer.disconnect();
      cancelQueuedRender?.();
    };
  }, [key, markdown, source]);

  return { hostRef: setHostRef, html };
};

export const DeferredMathMarkup = ({
  source,
  markdown,
  className,
}: {
  source: string;
  markdown: boolean;
  className?: string;
}) => {
  const { hostRef, html } = useDeferredCellMarkup(source, markdown);
  return (
    <span ref={hostRef} className={className}>
      {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span className="formula-render-pending">{source}</span>}
    </span>
  );
};
