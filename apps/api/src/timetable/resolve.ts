import type { TimetableEntryView } from '@lbrce/shared';
import { isWithinRange } from '../utils/time.js';

export interface StoredTimetable {
  id: string;
  title: string;
  department?: string;
  academicYear?: string;
  year?: number;
  semester?: number;
  section?: string;
  regulation?: string;
  degree?: string;
  batch?: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  verificationStatus: 'verified' | 'unverified' | 'rejected';
  sourceUrl?: string;
  imageUrl?: string;
  entries: TimetableEntryView[];
  updatedAt?: string;
}

export interface TimetableQuery {
  department?: string;
  academicYear?: string;
  year?: number;
  semester?: number;
  section?: string;
  day?: string;
  today: string;
}

export type TimetableResolution =
  | { status: 'none' }
  | { status: 'clarify'; question: string; options: string[] }
  | {
      status: 'match';
      timetable: StoredTimetable;
      day?: string;
      note?: string;
      conflictNote?: string;
      verificationStatus: 'verified' | 'unverified' | 'conflict';
    };

export function resolveTimetableQuery(query: TimetableQuery, records: StoredTimetable[]): TimetableResolution {
  let pool = records.filter((record) => record.verificationStatus !== 'rejected');
  if (query.department) {
    const needle = query.department.toLowerCase();
    pool = pool.filter((record) => record.department?.toLowerCase() === needle);
  }
  if (query.year) pool = pool.filter((record) => record.year === query.year);
  if (query.semester) pool = pool.filter((record) => record.semester === query.semester);
  if (query.section) pool = pool.filter((record) => record.section?.toLowerCase() === query.section?.toLowerCase());
  if (query.academicYear) {
    pool = pool.filter((record) => record.academicYear === query.academicYear);
  }
  if (!pool.length) return { status: 'none' };

  const missing = clarificationFor(query, pool);
  if (missing) return missing;

  const covering = pool.filter((record) => isWithinRange(query.today, record.effectiveFrom, record.effectiveUntil));
  const dated = covering.length ? covering : pool;
  const ranked = [...dated].sort((a, b) => score(b, query.today) - score(a, query.today));
  const selected = ranked[0];
  if (!selected) return { status: 'none' };

  const rivals = ranked.filter((record) => record.id !== selected.id && sameSlot(record, selected));
  const conflict = rivals.find((record) => conflicts(selected, record));
  const outdated = !covering.length;
  const years = unique(pool.map((record) => record.academicYear).filter(Boolean) as string[]);
  const otherYears = years.filter((year) => year !== selected.academicYear);
  return {
    status: 'match',
    timetable: selected,
    day: query.day,
    verificationStatus: conflict ? 'conflict' : selected.verificationStatus === 'verified' ? 'verified' : 'unverified',
    conflictNote: conflict
      ? `Another ${conflict.verificationStatus} timetable (${conflict.title}) lists different subjects for the same class. The newer applicable record is shown, and the difference should be checked against the official documents.`
      : undefined,
    note: [
      outdated ? 'No timetable with validity dates covering today was found. The latest matching record is shown and may be outdated.' : '',
      selected.verificationStatus !== 'verified' ? 'This timetable has not been marked verified by an administrator.' : '',
      selected.entries.length === 0
        ? 'The official timetable file was found, but period-level cells have not been extracted or verified. The source image or document is linked instead of a guessed grid.'
        : '',
      otherYears.length && selected.academicYear
        ? `Showing ${selected.academicYear}. Other indexed years for this class: ${otherYears.slice(0, 4).join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

function clarificationFor(query: TimetableQuery, pool: StoredTimetable[]): TimetableResolution | undefined {
  if (!query.department) {
    const departments = unique(pool.map((record) => record.department).filter(Boolean) as string[]);
    if (departments.length > 1) {
      return {
        status: 'clarify',
        question: 'Which department timetable should I use?',
        options: departments.slice(0, 8),
      };
    }
  }
  if (!query.semester) {
    const semesters = unique(pool.map((record) => (record.semester ? `Semester ${record.semester}` : '')).filter(Boolean));
    if (semesters.length > 1) {
      return {
        status: 'clarify',
        question: 'Which semester should I use?',
        options: semesters.slice(0, 8),
      };
    }
  }
  if (!query.section) {
    const sections = unique(pool.map((record) => (record.section ? `Section ${record.section}` : '')).filter(Boolean));
    if (sections.length > 1) {
      return {
        status: 'clarify',
        question: 'Which section should I use?',
        options: sections.slice(0, 8),
      };
    }
  }
  const classIsSpecified = Boolean(query.department && query.semester && query.section);
  if (!query.academicYear && !classIsSpecified) {
    const years = unique(pool.map((record) => record.academicYear).filter(Boolean) as string[]);
    const validYears = unique(
      pool
        .filter((record) => isWithinRange(query.today, record.effectiveFrom, record.effectiveUntil))
        .map((record) => record.academicYear)
        .filter(Boolean) as string[],
    );
    if (years.length > 1 && validYears.length !== 1) {
      return {
        status: 'clarify',
        question: 'Which academic year should I use?',
        options: years.slice(0, 8),
      };
    }
  }
  return undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sameSlot(a: StoredTimetable, b: StoredTimetable): boolean {
  return a.department === b.department && a.year === b.year && a.semester === b.semester && a.section === b.section;
}

function conflicts(a: StoredTimetable, b: StoredTimetable): boolean {
  for (const left of a.entries) {
    const right = b.entries.find(
      (entry) =>
        entry.dayOfWeek.toLowerCase() === left.dayOfWeek.toLowerCase() &&
        entry.periodNumber !== undefined &&
        entry.periodNumber === left.periodNumber,
    );
    if (!right) continue;
    const leftSubject = `${left.subjectCode ?? ''} ${left.subjectName ?? ''}`.trim().toLowerCase();
    const rightSubject = `${right.subjectCode ?? ''} ${right.subjectName ?? ''}`.trim().toLowerCase();
    if (leftSubject && rightSubject && leftSubject !== rightSubject) return true;
  }
  return false;
}

function score(record: StoredTimetable, today: string): number {
  let value = 0;
  if (record.verificationStatus === 'verified') value += 50;
  if (isWithinRange(today, record.effectiveFrom, record.effectiveUntil)) value += 20;
  if (record.effectiveFrom) value += Math.min(10, record.effectiveFrom.slice(0, 4).charCodeAt(0) / 100);
  if (record.academicYear) value += Number(record.academicYear.slice(0, 4)) / 1000;
  if (record.entries.length) value += 5;
  if (record.updatedAt) value += 1;
  return value;
}

export function labelFor(record: StoredTimetable): string {
  return [
    record.department,
    record.academicYear,
    record.year ? `Year ${record.year}` : '',
    record.semester ? `Sem ${record.semester}` : '',
    record.section ? `Section ${record.section}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
