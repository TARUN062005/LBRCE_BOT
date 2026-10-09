import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, getAdminToken, setAdminToken } from '../api/client';

export function LoginPage() {
  const [email, setEmail] = useState('admin@lbrce.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const result = await api<{ token: string }>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAdminToken(result.token);
      window.location.assign('/admin');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Login failed');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Admin sign in</h1>
      <p className="mt-2 text-sm text-muted">Maintenance access for the LBRCE knowledge base.</p>
      <form className="mt-6 space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm font-semibold">
          Email
          <input className="mt-1 w-full rounded-md border border-line px-3 py-2" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-sm font-semibold">
          Password
          <input type="password" className="mt-1 w-full rounded-md border border-line px-3 py-2" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="text-sm text-red-800">{error}</p> : null}
        <button className="w-full rounded-lg bg-brand py-2 font-semibold text-white" type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}

export function AdminHome() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Record<string, unknown>>('/api/admin/dashboard')
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Unauthorized'));
  }, []);
  if (!getAdminToken() && error) return <Navigate to="/admin/login" replace />;
  return (
    <AdminShell>
      {error ? <p className="text-sm text-red-800">{error}</p> : null}
      {data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {['pages', 'documents', 'chunks', 'images', 'failedJobs', 'documentsAwaitingVerification', 'timetablesAwaitingVerification'].map((key) => (
            <div key={key} className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-muted">{key}</p>
              <p className="mt-1 text-2xl font-semibold">{String(data[key] ?? 0)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Loading dashboard…</p>
      )}
      <p className="text-sm text-muted">Latest successful ingestion: {String(data?.latestSuccessAt ?? 'none')}</p>
    </AdminShell>
  );
}

export function IngestionAdmin() {
  const [jobs, setJobs] = useState<{ _id: string; status: string; error?: string; logs?: string[]; finishedAt?: string }[]>([]);
  const [message, setMessage] = useState('');

  async function refresh() {
    const result = await api<{ data: typeof jobs }>('/api/admin/ingestion/status');
    setJobs(result.data);
  }
  useEffect(() => {
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed'));
  }, []);

  return (
    <AdminShell>
      <button
        type="button"
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
        onClick={() =>
          void api('/api/admin/ingestion/run', { method: 'POST' })
            .then(() => {
              setMessage('Refresh queued. The worker processes it in the background.');
              return refresh();
            })
            .catch((error) => setMessage(error instanceof Error ? error.message : 'Failed'))
        }
      >
        Refresh official website
      </button>
      {message ? <p className="text-sm">{message}</p> : null}
      <ul className="space-y-3">
        {jobs.map((job) => (
          <li key={job._id} className="rounded-xl border border-line bg-white p-3 text-sm">
            <p className="font-semibold">
              {job.status}
              {job.finishedAt ? ` · ${job.finishedAt}` : ''}
            </p>
            {job.error ? <p className="text-red-800">{job.error}</p> : null}
            <pre className="mt-2 whitespace-pre-wrap text-xs text-muted">{(job.logs ?? []).slice(-6).join('\n')}</pre>
            {job.status === 'failed' ? (
              <button type="button" className="mt-2 text-brand" onClick={() => void api(`/api/admin/ingestion/${job._id}/retry`, { method: 'POST' }).then(refresh)}>
                Retry
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </AdminShell>
  );
}

export function DocumentsAdmin() {
  const [rows, setRows] = useState<{ _id: string; title: string; status: string; preview?: string }[]>([]);
  const [message, setMessage] = useState('');

  async function load() {
    const result = await api<{ data: typeof rows }>('/api/admin/documents');
    setRows(result.data);
  }
  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed'));
  }, []);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const meta = {
      title: String(form.get('title') ?? ''),
      documentType: String(form.get('documentType') ?? 'notice'),
      department: String(form.get('department') ?? ''),
      academicYear: String(form.get('academicYear') ?? ''),
      semester: String(form.get('semester') ?? ''),
    };
    form.set('meta', JSON.stringify(meta));
    await api('/api/admin/documents/upload', { method: 'POST', body: form });
    setMessage('Uploaded. Review the preview, then publish it to the assistant.');
    await load();
  }

  return (
    <AdminShell>
      <form className="grid gap-2 rounded-xl border border-line bg-white p-4 sm:grid-cols-2" onSubmit={(event) => void upload(event).catch((error) => setMessage(error.message))}>
        <input name="title" placeholder="Title" className="rounded-md border border-line px-2 py-2" />
        <input name="department" placeholder="Department" className="rounded-md border border-line px-2 py-2" />
        <input name="academicYear" placeholder="Academic year" className="rounded-md border border-line px-2 py-2" />
        <input name="semester" placeholder="Semester" className="rounded-md border border-line px-2 py-2" />
        <select name="documentType" className="rounded-md border border-line px-2 py-2">
          {['notice', 'timetable', 'circular', 'calendar', 'fee', 'syllabus', 'regulation', 'placement', 'other'].map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <input name="file" type="file" required className="text-sm" />
        <p className="text-xs text-muted sm:col-span-2">PDF, DOCX, TXT, HTML, CSV, and XLSX up to 15 MB. Images are accepted only when OCR is enabled on the server.</p>
        <button className="rounded-lg bg-brand px-3 py-2 text-white sm:col-span-2" type="submit">
          Upload
        </button>
      </form>
      {message ? <p className="text-sm">{message}</p> : null}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row._id} className="rounded-xl border border-line bg-white p-3">
            <p className="font-semibold">{row.title}</p>
            <p className="text-xs uppercase text-muted">{row.status}</p>
            <p className="mt-2 line-clamp-4 text-sm text-muted">{row.preview}</p>
            <div className="mt-2 flex gap-3 text-sm">
              <button type="button" onClick={() => void api(`/api/admin/documents/${row._id}/publish`, { method: 'POST' }).then(load)}>
                Publish
              </button>
              <button type="button" onClick={() => void api(`/api/admin/documents/${row._id}/archive`, { method: 'POST' }).then(load)}>
                Archive
              </button>
            </div>
          </li>
        ))}
      </ul>
    </AdminShell>
  );
}

export function TimetableAdmin() {
  const [rows, setRows] = useState<{ _id: string; title: string; department?: string; section?: string; verificationStatus: string; semester?: number }[]>([]);
  const [selected, setSelected] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const result = await api<{ data: typeof rows }>('/api/admin/timetables');
    setRows(result.data);
  }
  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed'));
  }, []);

  return (
    <AdminShell>
      {message ? <p className="text-sm text-red-800">{message}</p> : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
            <span>
              {row.title} · {row.department} · sem {row.semester ?? '—'} · {row.section ?? '—'} · {row.verificationStatus}
            </span>
            <button type="button" className="text-brand" onClick={() => setSelected(row._id)}>
              Correct
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <form
          className="space-y-2 rounded-xl border border-line bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void api(`/api/admin/timetables/${selected}`, {
              method: 'PATCH',
              body: JSON.stringify({
                entries: subject
                  ? [{ dayOfWeek: 'monday', periodNumber: 1, subjectName: subject, entryType: 'lecture' }]
                  : [],
              }),
            })
              .then(() => api('/api/admin/timetables/verify', { method: 'POST', body: JSON.stringify({ id: selected }) }))
              .then(() => {
                setMessage('Correction saved and marked verified.');
                return load();
              })
              .catch((error) => setMessage(error instanceof Error ? error.message : 'Failed'));
          }}
        >
          <p className="text-sm">Replace Monday period 1 for the selected timetable, then mark it verified.</p>
          <input className="w-full rounded-md border border-line px-2 py-2" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Verified subject name" />
          <button className="rounded-lg bg-brand px-3 py-2 text-white" type="submit">
            Save correction
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted">No timetable is selected. The queue stays empty until ingestion or an upload creates one.</p>
      )}
    </AdminShell>
  );
}

export function RetrievalAdmin() {
  const [query, setQuery] = useState('CSE timetable');
  const [result, setResult] = useState('');
  return (
    <AdminShell>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void api(`/api/admin/retrieval?q=${encodeURIComponent(query)}`)
            .then((data) => setResult(JSON.stringify(data, null, 2)))
            .catch((error) => setResult(error instanceof Error ? error.message : 'Failed'));
        }}
      >
        <input className="flex-1 rounded-md border border-line px-2 py-2" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button className="rounded-lg bg-brand px-3 py-2 text-white" type="submit">
          Inspect
        </button>
      </form>
      <pre className="overflow-auto rounded-xl border border-line bg-white p-3 text-xs">{result}</pre>
    </AdminShell>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  if (!getAdminToken()) return <Navigate to="/admin/login" replace />;
  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Knowledge base</h1>
        <nav className="flex flex-wrap gap-3 text-sm text-brand">
          <Link to="/admin">Overview</Link>
          <Link to="/admin/ingestion">Ingestion</Link>
          <Link to="/admin/documents">Documents</Link>
          <Link to="/admin/timetables">Timetables</Link>
          <Link to="/admin/retrieval">Retrieval</Link>
          <Link to="/">Chat</Link>
        </nav>
      </header>
      {children}
    </main>
  );
}
