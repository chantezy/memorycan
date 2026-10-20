import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a chat message body as rich text (markdown) instead of a raw string.
 * Server component — safe by default (react-markdown does NOT render raw HTML
 * unless rehype-raw is added, so chat content can't inject markup).
 */
export default function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
        }}
      >
        {text || ""}
      </ReactMarkdown>
    </div>
  );
}
