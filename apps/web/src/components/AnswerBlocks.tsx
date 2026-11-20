import type { AnswerBlock } from '@lbrce/shared';
import { Citations, isCollegeUrl } from './Citations';
import { DataTable } from './DataTable';
import { ImageGallery } from './ImageGallery';
import { MarkdownView } from './MarkdownView';
import { TimetableView } from './TimetableView';

export function AnswerBlocks({
  blocks,
  onChoose,
  showSources = false,
}: {
  blocks: AnswerBlock[];
  onChoose?: (option: string) => void;
  showSources?: boolean;
}) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => (
        <Block key={`${block.type}-${index}`} block={block} onChoose={onChoose} showSources={showSources} />
      ))}
    </div>
  );
}

function Block({ block, onChoose, showSources }: { block: AnswerBlock; onChoose?: (option: string) => void; showSources: boolean }) {
  if (block.type === 'document_summary') {
    const pdf = Boolean(block.documentUrl && /\.pdf(?:$|\?)/i.test(block.documentUrl) && isCollegeUrl(block.documentUrl));
    return (
      <div>
        <MarkdownView markdown={block.markdown} showSources={showSources} />
        {pdf && block.documentUrl ? (
          <iframe title={block.title} src={documentFrameSrc(block.documentUrl)} className="mt-3 h-[72vh] w-full rounded-2xl bg-white" />
        ) : null}
      </div>
    );
  }
  if (block.type === 'text') {
    return (
      <div>
        <MarkdownView markdown={block.markdown} showSources={showSources} />
        {showSources ? <Citations citations={block.citations} /> : null}
      </div>
    );
  }
  if (block.type === 'table') {
    return <DataTable title={block.title} columns={block.columns} rows={block.rows} citations={showSources ? block.citations : []} />;
  }
  if (block.type === 'timetable') {
    return (
      <TimetableView
        title={block.title}
        view={block.view}
        entries={block.entries}
        note={block.note}
        imageUrl={block.imageUrl}
        day={block.day}
        academicYear={block.academicYear}
        department={block.department}
        semester={block.semester}
        section={block.section}
        citations={block.citations}
        showSources={showSources}
      />
    );
  }
  if (block.type === 'image_gallery') return <ImageGallery images={block.images} />;
  if (block.type === 'source_list') {
    if (!showSources) return null;
    return (
      <div>
        {block.title ? <h3 className="font-semibold">{block.title}</h3> : null}
        <Citations citations={block.sources} />
      </div>
    );
  }
  if (block.type === 'clarification') {
    return (
      <div>
        <p className="text-[15px] leading-7">{block.question}</p>
        {block.options.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {block.options.map((option) => (
              <button
                key={option}
                type="button"
                className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-sm hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!onChoose}
                onClick={() => onChoose?.(option)}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (block.type === 'evidence') return null;
  return (
    <div>
      <p className="text-[15px] leading-7">{block.message}</p>
    </div>
  );
}

function documentFrameSrc(url: string): string {
  const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '') || 'document.pdf';
  return `/api/media/${encodeURIComponent(name)}?url=${encodeURIComponent(url)}`;
}
