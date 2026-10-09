import type { Citation, TimetableEntryView } from '@lbrce/shared';
import { Citations } from './Citations';
import { DataTable } from './DataTable';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function TimetableView({
  title,
  view,
  entries,
  note,
  imageUrl,
  sourceUrl,
  effectiveFrom,
  verificationStatus,
  day,
  citations,
}: {
  title: string;
  view: 'day' | 'week';
  entries: TimetableEntryView[];
  note?: string;
  imageUrl?: string;
  sourceUrl?: string;
  effectiveFrom?: string;
  verificationStatus: string;
  day?: string;
  citations: Citation[];
}) {
  const columns = ['Period', 'Time', 'Subject', 'Faculty', 'Room'];
  const rows = entries.map((entry) => [
    entry.periodNumber ? String(entry.periodNumber) : entry.dayOfWeek,
    [entry.startTime, entry.endTime].filter(Boolean).join('–'),
    [entry.subjectCode, entry.subjectName].filter(Boolean).join(' · '),
    entry.faculty ?? '',
    entry.room ?? '',
  ]);

  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <p className="text-sm text-muted">
            {view === 'day' && day ? `${capitalize(day)} schedule` : 'Weekly schedule'} · {verificationStatus}
            {effectiveFrom ? ` · effective ${effectiveFrom.slice(0, 10)}` : ''}
          </p>
        </div>
        <button type="button" className="no-print rounded-md border border-line px-3 py-1.5 text-sm" onClick={() => window.print()}>
          Print
        </button>
      </div>
      {note ? <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">{note}</p> : null}
      {entries.length ? (
        view === 'week' && new Set(entries.map((entry) => entry.dayOfWeek.toLowerCase())).size > 1 ? (
          <WeekGrid entries={entries} />
        ) : (
          <DataTable columns={columns} rows={rows} />
        )
      ) : (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-muted">
          Period cells have not been verified for this timetable.
        </p>
      )}
      {imageUrl ? (
        <figure className="space-y-2">
          <img src={imageUrl} alt={title} className="max-h-[480px] w-full rounded-lg border border-line object-contain" />
          {sourceUrl ? (
            <figcaption className="text-sm">
              <a className="text-brand" href={sourceUrl} target="_blank" rel="noreferrer">
                Open the official source
              </a>
            </figcaption>
          ) : null}
        </figure>
      ) : null}
      <Citations citations={citations} />
    </section>
  );
}

function WeekGrid({ entries }: { entries: TimetableEntryView[] }) {
  const periods = [...new Set(entries.map((entry) => entry.periodNumber ?? 0))].sort((a, b) => a - b);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-brand-light">
          <tr>
            <th className="px-3 py-2">Period</th>
            {DAYS.map((day) => (
              <th key={day} className="px-3 py-2 capitalize">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period} className="border-t border-line">
              <td className="px-3 py-2 font-semibold">{period || '—'}</td>
              {DAYS.map((day) => {
                const entry = entries.find((item) => item.dayOfWeek.toLowerCase() === day && (item.periodNumber ?? 0) === period);
                return (
                  <td key={day} className={`px-3 py-2 align-top ${tone(entry?.entryType)}`}>
                    {entry ? (
                      <>
                        <div className="font-semibold">{entry.subjectName || entry.subjectCode}</div>
                        <div className="text-xs text-muted">{[entry.faculty, entry.room, entry.startTime].filter(Boolean).join(' · ')}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function tone(type?: string): string {
  if (type === 'lab') return 'bg-sky-50';
  if (type === 'break') return 'bg-amber-50';
  if (type === 'free') return 'bg-stone-50';
  return '';
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
