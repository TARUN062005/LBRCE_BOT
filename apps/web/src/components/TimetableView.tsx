import type { Citation, TimetableEntryView } from '@lbrce/shared';
import { Citations, isCollegeUrl } from './Citations';
import { DataTable } from './DataTable';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function TimetableView({
  title,
  view,
  entries,
  note,
  imageUrl,
  academicYear,
  department,
  semester,
  section,
  citations,
  showSources = false,
}: {
  title: string;
  view: 'day' | 'week';
  entries: TimetableEntryView[];
  note?: string;
  imageUrl?: string;
  sourceUrl?: string;
  effectiveFrom?: string;
  verificationStatus?: string;
  day?: string;
  academicYear?: string;
  department?: string;
  semester?: number;
  section?: string;
  citations: Citation[];
  showSources?: boolean;
}) {
  const columns = ['Period', 'Time', 'Subject', 'Faculty', 'Room'];
  const rows = entries.map((entry) => [
    entry.periodNumber ? String(entry.periodNumber) : entry.dayOfWeek,
    [entry.startTime, entry.endTime].filter(Boolean).join('–'),
    [entry.subjectCode, entry.subjectName].filter(Boolean).join(' · '),
    entry.faculty ?? '',
    entry.room ?? '',
  ]);

  const label = [department, semester ? `Semester ${semester}` : '', section ? `Section ${section}` : '', academicYear]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className="space-y-3" aria-label={title}>
      {label ? <h3 className="text-base font-semibold text-ink">{label}</h3> : null}
      {note ? <p className="text-sm text-muted">{note}</p> : null}
      {entries.length ? (
        view === 'week' && new Set(entries.map((entry) => entry.dayOfWeek.toLowerCase())).size > 1 ? (
          <WeekGrid entries={entries} />
        ) : (
          <DataTable columns={columns} rows={rows} />
        )
      ) : (
        <p className="text-sm text-muted">The timetable image was retrieved. The period grid was not read, so no subjects or times are listed.</p>
      )}
      {imageUrl && isCollegeUrl(imageUrl) ? (
        <img src={imageUrl} alt={label || title} className="max-h-[70vh] w-full rounded-2xl object-contain" />
      ) : null}
      {showSources && citations.length ? <Citations citations={citations} /> : null}
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
