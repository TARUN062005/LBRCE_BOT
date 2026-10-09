import type { AnswerBlock } from '@lbrce/shared';
import { Citations } from './Citations';
import { DataTable } from './DataTable';
import { ImageGallery } from './ImageGallery';
import { MarkdownView } from './MarkdownView';
import { TimetableView } from './TimetableView';

export function AnswerBlocks({ blocks }: { blocks: AnswerBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => (
        <Block key={`${block.type}-${index}`} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: AnswerBlock }) {
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
      <div className="rounded-lg border border-brand/20 bg-brand-light p-3">
        <p className="font-semibold">{block.question}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {block.options.map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ul>
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
