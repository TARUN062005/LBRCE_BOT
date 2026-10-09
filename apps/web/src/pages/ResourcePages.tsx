import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import { DEPARTMENT_MATCHERS } from '@lbrce/shared';
import { api } from '../api/client';
import { DataTable } from '../components/DataTable';
import { TimetableView } from '../components/TimetableView';
import type { AnswerBlock } from '@lbrce/shared';

const BRANCHES = [...DEPARTMENT_MATCHERS].sort((a, b) => a.name.localeCompare(b.name));
const YEARS = ['1', '2', '3', '4'];
const SEMESTERS = ['1', '2', '3', '4', '5', '6', '7', '8'];
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function TimetablePage() {
  const [department, setDepartment] = useState('CSE');
  const [year, setYear] = useState('2');
  const [semester, setSemester] = useState('3');
  const [section, setSection] = useState('A');
  const [block, setBlock] = useState<Extract<AnswerBlock, { type: 'timetable' }> | null>(null);
  const [message, setMessage] = useState('Choose a branch, year, semester, and section. Empty period cells are left empty.');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setBlock(null);
    try {
      const params = new URLSearchParams({ department, year, semester, section });
      const result = await api<{ resolution: { status: string; question?: string; note?: string; timetable?: Record<string, unknown>; verificationStatus?: string; day?: string; options?: string[] } }>(
        `/api/timetables/search?${params.toString()}`,
      );
      if (result.resolution.status === 'clarify') {
        const options = result.resolution.options ?? [];
        setMessage([result.resolution.question ?? 'More detail is needed.', options.join(', ')].filter(Boolean).join(' '));
        return;
      }
      if (result.resolution.status !== 'match' || !result.resolution.timetable) {
        setMessage('No indexed timetable matches that class.');
        return;
      }
      const timetable = result.resolution.timetable as {
        title: string;
        entries: Extract<AnswerBlock, { type: 'timetable' }>['entries'];
        imageUrl?: string;
        sourceUrl?: string;
        effectiveFrom?: string;
        academicYear?: string;
        department?: string;
        year?: number;
        semester?: number;
        section?: string;
        verificationStatus: 'verified' | 'unverified' | 'rejected';
      };
      setBlock({
        type: 'timetable',
        title: timetable.title,
        view: 'week',
        entries: timetable.entries ?? [],
        imageUrl: timetable.imageUrl,
        effectiveFrom: timetable.effectiveFrom,
        academicYear: timetable.academicYear,
        department: timetable.department,
        year: timetable.year,
        semester: timetable.semester,
        section: timetable.section,
        verificationStatus: result.resolution.verificationStatus === 'conflict' ? 'conflict' : timetable.verificationStatus === 'verified' ? 'verified' : 'unverified',
        note: result.resolution.note,
        citations: [{ id: 'timetable', title: timetable.title, url: timetable.sourceUrl, verificationStatus: 'unverified', sourceType: 'timetable' }],
      });
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell title="Timetable" description="Searches stored timetable records and validity dates. The official image is shown when period cells have not been extracted.">
      <form className="grid gap-3 rounded-2xl border border-line bg-white p-4 shadow-card sm:grid-cols-5" onSubmit={onSubmit}>
        <Select label="Branch" value={department} onChange={setDepartment} options={BRANCHES.map((branch) => ({ value: branch.code, label: `${branch.name} (${branch.code})` }))} />
        <Select label="Year" value={year} onChange={setYear} options={YEARS.map((value) => ({ value, label: `Year ${value}` }))} />
        <Select label="Semester" value={semester} onChange={setSemester} options={SEMESTERS.map((value) => ({ value, label: `Semester ${value}` }))} />
        <Select label="Section" value={section} onChange={setSection} options={SECTIONS.map((value) => ({ value, label: `Section ${value}` }))} />
        <button className="self-end rounded-lg bg-brand px-3 py-2 font-semibold text-white hover:bg-brand-dark" type="submit">
          {loading ? 'Searching' : 'Search'}
        </button>
      </form>
      {message ? <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted">{message}</p> : null}
      {block ? (
        <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
          <TimetableView
            title={block.title}
            view={block.view}
            entries={block.entries}
            note={block.note}
            imageUrl={block.imageUrl}
            effectiveFrom={block.effectiveFrom}
            verificationStatus={block.verificationStatus}
            citations={block.citations}
            sourceUrl={block.citations[0]?.url}
          />
        </div>
      ) : null}
    </PageShell>
  );
}

interface FacultyPerson {
  name: string;
  designation?: string;
  department?: string;
  verificationStatus: string;
  sourceUrl?: string;
}

export function FacultyPage() {
  const [department, setDepartment] = useState('CSE');
  const [people, setPeople] = useState<FacultyPerson[]>([]);
  const [message, setMessage] = useState('Choose a branch, then search. Names come from the indexed official faculty page.');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await api<{ faculty: FacultyPerson[] }>(`/api/search?q=${encodeURIComponent(`${department} faculty`)}`);
      const rows = [...(result.faculty ?? [])].sort((a, b) => Number(isHead(b)) - Number(isHead(a)) || a.name.localeCompare(b.name));
      setPeople(rows);
      setMessage(rows.length ? '' : 'No faculty records have been indexed for that branch.');
    } catch (error) {
      setPeople([]);
      setMessage(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  const branch = BRANCHES.find((item) => item.code === department);
  const heads = people.filter(isHead);

  return (
    <PageShell title="Faculty directory" description="Pick a branch from the list. Results are the names extracted from the official faculty page.">
      <form className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 shadow-card sm:flex-row sm:items-end" onSubmit={onSubmit}>
        <Select
          label="Branch"
          value={department}
          onChange={setDepartment}
          options={BRANCHES.map((item) => ({ value: item.code, label: `${item.name} (${item.code})` }))}
        />
        <button className="rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-dark" type="submit">
          {loading ? 'Searching' : 'Search'}
        </button>
      </form>
      {message ? <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted">{message}</p> : null}
      {people.length ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Branch" value={branch ? `${branch.name}` : department} />
            <Stat label="Indexed names" value={String(people.length)} />
            <Stat label="Head" value={heads.map((person) => person.name).join(', ') || 'Not marked in the index'} />
          </div>
          {heads.length ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {heads.map((person) => (
                <li key={`${person.name}-head`} className="rounded-2xl border border-brand/20 bg-brand-light p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand">Head of department</p>
                  <p className="mt-1 text-lg font-semibold">{person.name}</p>
                  <p className="text-sm text-muted">{person.designation}</p>
                  {person.sourceUrl ? (
                    <a className="mt-2 inline-block text-sm font-semibold text-brand" href={person.sourceUrl} target="_blank" rel="noreferrer">
                      Open official page
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
            <DataTable
              title={`${branch?.code ?? department} faculty`}
              columns={['Name', 'Designation', 'Department', 'Verification']}
              rows={people.map((person) => [person.name, person.designation ?? '', person.department ?? '', person.verificationStatus])}
              citations={uniqueSources(people)}
            />
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

export function NoticesPage({ documentType = 'notice', title = 'College notices', description = 'Published notices and circulars from the index.' }: { documentType?: string; title?: string; description?: string }) {
  const [documents, setDocuments] = useState<{ id: string; title: string; sourceUrl?: string; createdAt?: string; verificationStatus?: string }[]>([]);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    void api<{ data: { id: string; title: string; sourceUrl?: string; createdAt?: string; verificationStatus?: string }[] }>(
      `/api/documents?documentType=${documentType}&limit=50`,
    )
      .then((result) => {
        setDocuments(result.data);
        setEmpty(result.data.length === 0);
      })
      .catch(() => setEmpty(true));
  }, [documentType]);

  return (
    <PageShell title={title} description={description}>
      {empty ? <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted">No published documents of this type are indexed yet.</p> : null}
      {documents.length ? <p className="text-sm text-muted">{documents.length} indexed document{documents.length === 1 ? '' : 's'}. Each link opens the official file.</p> : null}
      <ul className="grid gap-3">
        {documents.map((document) => (
          <li key={document.id} className="rounded-2xl border border-line bg-white p-4 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{cleanTitle(document.title)}</h3>
                <p className="mt-1 text-sm text-muted">{[document.verificationStatus, document.createdAt?.slice(0, 10)].filter(Boolean).join(' · ')}</p>
              </div>
              {document.sourceUrl ? (
                <a className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark" href={document.sourceUrl} target="_blank" rel="noreferrer">
                  Open official file
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}

export function SettingsPage() {
  const [health, setHealth] = useState<{ status: string; mongo: string; gemini: string; vectorSearch: string; ocr: boolean } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ status: string; mongo: string; gemini: string; vectorSearch: string; ocr: boolean }>('/api/health')
      .then(setHealth)
      .catch(() => setError('The API is not reachable. Start the backend and confirm VITE_API_URL.'));
  }, []);
  return (
    <PageShell title="Settings" description="Connection status only. API keys stay on the server.">
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</p> : null}
      {health ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="API" value={health.status} />
          <Stat label="Database" value={health.mongo} />
          <Stat label="Gemini" value={health.gemini} />
          <Stat label="Search" value={health.vectorSearch} />
          <Stat label="OCR" value={health.ocr ? 'enabled' : 'disabled'} />
        </div>
      ) : null}
      <div className="rounded-2xl border border-line bg-white p-4 text-sm leading-6 text-ink shadow-card">
        <h3 className="font-semibold">How answers are fetched</h3>
        <p className="mt-2 text-muted">
          A question searches the indexed copy of the official website. It does not download lbrce.ac.in again at the moment you ask. Source links in each answer open the live official page. An administrator refresh is how new notices and timetables enter the index.
        </p>
      </div>
    </PageShell>
  );
}

function PageShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-5xl space-y-4 px-4 pb-10 pt-16 sm:px-8 lg:pt-8">
      <div className="rounded-2xl border border-line bg-white px-5 py-5 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">LBRCE</p>
        <h2 className="mt-1 text-2xl font-semibold">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <select className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2 font-normal" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function isHead(person: FacultyPerson): boolean {
  return /head of the department|\bhod\b|\bhead\b/i.test(person.designation ?? '');
}

function uniqueSources(people: FacultyPerson[]) {
  const seen = new Set<string>();
  return people.flatMap((person) => {
    if (!person.sourceUrl || seen.has(person.sourceUrl)) return [];
    seen.add(person.sourceUrl);
    return [{ id: person.sourceUrl, title: 'Official faculty page', url: person.sourceUrl, verificationStatus: 'unverified' as const, sourceType: 'webpage' as const }];
  });
}

function cleanTitle(title: string): string {
  return title.replace(/\.pdf$/i, '').replaceAll('_', ' ');
}
