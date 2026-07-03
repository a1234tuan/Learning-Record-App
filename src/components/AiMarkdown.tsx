import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import "katex/dist/katex.min.css";

interface AiMarkdownProps {
  content: string;
}

export const AiMarkdown = ({ content }: AiMarkdownProps) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
  >
    {content}
  </ReactMarkdown>
);
