import { ExternalLink } from 'lucide-react';
import type { Citation } from '@lbrce/shared';

export function Citations({ citations }: { citations: Citation[] }) {
  const unique = citations.filter((citation, index) => {
    if (citation.url && !isCollegeUrl(citation.url)) return false;
    const key = citation.url || citation.id;
    return citations.findIndex((item) => (item.url || item.id) === key) === index;
  });
  if (!unique.length) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Official links</p>
      <ol className="mt-2 space-y-2">
        {unique.map((citation) => (
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

export function isCollegeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'lbrce.ac.in' || host.endsWith('.lbrce.ac.in');
  } catch {
    return false;
  }
}

function safeUrl(url: string): string {
  return isCollegeUrl(url) ? url : '#';
}
