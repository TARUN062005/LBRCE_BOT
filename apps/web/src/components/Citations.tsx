import { ExternalLink } from 'lucide-react';
import type { Citation } from '@lbrce/shared';

export function Citations({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Official links</p>
      <ol className="mt-2 space-y-2">
        {citations.map((citation) => (
          <li key={citation.id} className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink">
            {citation.url ? (
              <a href={safeUrl(citation.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand">
                {citation.title}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : (
              <span className="font-semibold">{citation.title}</span>
            )}
            {citation.url ? <span className="mt-0.5 block truncate text-xs text-muted">{citation.url}</span> : null}
            <span className="mt-0.5 block text-xs text-muted">
              {[
                citation.pageNumber ? `Page ${citation.pageNumber}` : '',
                citation.section,
                citation.effectiveFrom ? `Effective ${citation.effectiveFrom.slice(0, 10)}` : '',
                citation.publishedAt ? `Published ${citation.publishedAt.slice(0, 10)}` : '',
                citation.retrievedAt ? `Retrieved ${citation.retrievedAt.slice(0, 10)}` : '',
                citation.verificationStatus,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function safeUrl(url: string): string {
  return /^(https?:)/i.test(url) ? url : '#';
}
