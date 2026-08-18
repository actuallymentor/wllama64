import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface MarkdownMessageProps {
  content: string;
}

const markdownComponents: Components = {
  pre({ children, ...props }) {
    return (
      <pre
        className="bg-base-200 rounded p-3 overflow-x-auto whitespace-pre-wrap"
        {...props}
      >
        {children}
      </pre>
    );
  },
  code({ children, ...props }) {
    return (
      <code className="bg-base-200 rounded px-1 py-[2px] text-sm" {...props}>
        {children}
      </code>
    );
  },
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        className="link"
        target="_blank"
        rel="noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
};

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={markdownComponents}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
