import { Mark, mergeAttributes } from "@tiptap/core";

const safeHref = (value: unknown): string => {
  const href = typeof value === "string" ? value.trim() : "";
  return /^(?:https?:|mailto:|\/|#)/i.test(href) ? href : "#";
};

export const MarkdownLinkMark = Mark.create({
  name: "link",
  inclusive: false,

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element) => element.getAttribute("href"),
        renderHTML: (attributes) => ({ href: safeHref(attributes.href) }),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("title"),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[href]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        href: safeHref(HTMLAttributes.href),
        rel: "noopener noreferrer",
        target: "_blank",
      }),
      0,
    ];
  },
});
