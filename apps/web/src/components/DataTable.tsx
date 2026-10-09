import { useMemo, useState } from 'react';
import type { Citation } from '@lbrce/shared';
import { Citations } from './Citations';

export function DataTable({
  title,
  columns,
  rows,
  citations = [],
}: {
  title?: string;
  columns: string[];
  rows: string[][];
  citations?: Citation[];
}) {
  const [sortIndex, setSortIndex] = useState(0);
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const filtered = rows.filter((row) => row.join(' ').toLowerCase().includes(filter.toLowerCase()));
    return [...filtered].sort((a, b) => {
      const result = (a[sortIndex] ?? '').localeCompare(b[sortIndex] ?? '', undefined, { numeric: true });
      return direction === 'asc' ? result : -result;
    });
  }, [rows, filter, sortIndex, direction]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {title ? <h3 className="text-base font-semibold">{title}</h3> : <span />}
        <div className="no-print flex gap-2">
          <input
            aria-label="Filter table"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter rows"
            className="rounded-md border border-line px-2 py-1 text-sm"
          />
          <button type="button" className="rounded-md border border-line px-2 py-1 text-sm" onClick={() => copyTable(columns, visible)}>
            Copy
          </button>
          <button type="button" className="rounded-md border border-line px-2 py-1 text-sm" onClick={() => downloadCsv(title ?? 'table', columns, visible)}>
            CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-brand-light text-brand-dark">
            <tr>
              {columns.map((column, index) => (
                <th key={column} className="border-b border-line px-3 py-2 font-semibold">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() => {
                      setSortIndex(index);
                      setDirection((current) => (sortIndex === index && current === 'asc' ? 'desc' : 'asc'));
                    }}
                  >
                    {column}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-muted">
                  No rows match this filter.
                </td>
              </tr>
            ) : (
              visible.map((row, rowIndex) => (
                <tr key={`${row.join('-')}-${rowIndex}`} className="odd:bg-white even:bg-canvas">
                  {columns.map((_, cellIndex) => (
                    <td key={cellIndex} className="border-t border-line px-3 py-2 align-top">
                      {row[cellIndex] || '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Citations citations={citations} />
    </div>
  );
}

export function tableToCsv(columns: string[], rows: string[][]): string {
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function copyTable(columns: string[], rows: string[][]) {
  void navigator.clipboard?.writeText([columns.join('\t'), ...rows.map((row) => row.join('\t'))].join('\n'));
}

function downloadCsv(title: string, columns: string[], rows: string[][]) {
  const blob = new Blob([tableToCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/\s+/g, '-').toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
