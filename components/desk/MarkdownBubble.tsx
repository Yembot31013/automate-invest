"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

type MarkdownBubbleProps = {
  text: string;
  tone?: "user" | "assistant";
};

/**
 * Renders chat markdown fully contained inside the bubble —
 * no layout bleed outside the message box.
 */
export function MarkdownBubble({
  text,
  tone = "assistant",
}: MarkdownBubbleProps) {
  return (
    <div className={`md-bubble md-bubble-${tone}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="md-list">{children}</ul>,
          ol: ({ children }) => <ol className="md-list">{children}</ol>,
          li: ({ children }) => <li className="md-list-item">{children}</li>,
          img: ({ src, alt }) =>
            typeof src === "string" ? (
              // eslint-disable-next-line @next/next/no-img-element -- chat content URLs
              <img src={src} alt={alt ?? ""} loading="lazy" />
            ) : null,
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
