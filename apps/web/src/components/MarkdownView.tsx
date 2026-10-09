import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import type { Components } from 'react-markdown';

const components: Components = {
  a({ href, children }) {
    if (!href || !/^(https?:|mailto:)/i.test(href)) return <span>{children}</span>;
    return (
      <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">
        {children}
      </a>
    );
  },
  table({ children }) {
    return <div className="overflow-x-auto">{children}</div>;
  },
};

export function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="prose-chat space-y-3 text-[15px] leading-7 text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
