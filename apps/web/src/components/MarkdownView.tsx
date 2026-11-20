import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import type { Components } from 'react-markdown';
import { isCollegeUrl } from './Citations';

const components: Components = {
  a({ href, children }) {
    if (!href || !isCollegeUrl(href)) return <span>{children}</span>;
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

export function MarkdownView({ markdown, showSources = false }: { markdown: string; showSources?: boolean }) {
  return (
    <div className="prose-chat space-y-3 text-[15px] leading-7 text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {presentMarkdown(markdown, showSources)}
      </ReactMarkdown>
    </div>
  );
}

export function presentMarkdown(markdown: string, showSources: boolean): string {
  if (showSources) return markdown;
  return markdown
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
