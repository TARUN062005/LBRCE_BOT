import type { AnswerBlock } from '@lbrce/shared';
import { Citations } from './Citations';
import { DataTable } from './DataTable';
import { ImageGallery } from './ImageGallery';
import { MarkdownView } from './MarkdownView';
import { TimetableView } from './TimetableView';

export function AnswerBlocks({ blocks, onChoose }: { blocks: AnswerBlock[]; onChoose?: (option: string) => void }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => (
        <Block key={`${block.type}-${index}`} block={block} onChoose={onChoose} />
      ))}
    </div>
  );
}

function Block({ block, onChoose }: { block: AnswerBlock; onChoose?: (option: string) => void }) {
  if (block.type === 'text' || block.type === 'document_summary') {
    return (
      <div>
        <MarkdownView markdown={block.markdown} />
        <Citations citations={block.citations} />
      </div>
    );
  }
  if (block.type === 'table') {
    return <DataTable title={block.title} columns={block.columns} rows={block.rows} citations={block.citations} />;
  }
  if (block.type === 'timetable') {
    return (
      <TimetableView
        title={block.title}
        view={block.view}
        entries={block.entries}
        note={block.note}
        imageUrl={block.imageUrl}
        sourceUrl={block.citations[0]?.url}
        effectiveFrom={block.effectiveFrom}
        verificationStatus={block.verificationStatus}
        day={block.day}
        citations={block.citations}
      />
    );
  }
  if (block.type === 'image_gallery') return <ImageGallery title={block.title} images={block.images} />;
  if (block.type === 'source_list') {
    return (
      <div>
        {block.title ? <h3 className="font-semibold">{block.title}</h3> : null}
        <Citations citations={block.sources} />
      </div>
    );
  }
  if (block.type === 'clarification') {
    return (
      <div className="rounded-2xl border border-brand/20 bg-brand-light p-4">
        <p className="font-semibold text-ink">{block.question}</p>
        <p className="mt-1 text-sm text-muted">Choose one. The next reply uses that choice.</p>
        {block.options.length ? (
          <div className="mt-3 flex max-h-72 flex-wrap gap-2 overflow-y-auto">
            {block.options.map((option) => (
              <button
                key={option}
                type="button"
                className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-sm text-ink shadow-card hover:border-brand disabled:cursor-not-allowed disabled:opacity-60"
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
  return (
    <div className="rounded-lg border border-dashed border-line bg-canvas p-3 text-sm">
      <p>{block.message}</p>
      {block.suggestions.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          {block.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
