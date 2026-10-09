import { describe, expect, it } from 'vitest';
import { parseTimetableLocation } from './filename.js';
import { parseTimetableText, entriesFromSpreadsheet } from './parse.js';
import { resolveTimetableQuery, type StoredTimetable } from './resolve.js';

const base = (overrides: Partial<StoredTimetable>): StoredTimetable => ({
  id: 'tt-1',
  title: 'Synthetic timetable',
  department: 'CSE',
  academicYear: '2026-27',
  year: 2,
  semester: 3,
  section: 'A',
  verificationStatus: 'verified',
  effectiveFrom: '2026-07-01',
  effectiveUntil: '2026-12-15',
  entries: [
    {
      dayOfWeek: 'monday',
      periodNumber: 1,
      startTime: '09:00',
      endTime: '09:50',
      subjectCode: 'CS301',
      subjectName: 'Synthetic Subject',
      faculty: 'Example Faculty',
      room: 'C-101',
      entryType: 'lecture',
      confidence: 0.9,
    },
  ],
  ...overrides,
});

describe('timetable filename metadata', () => {
  it('reads department, year, semester, and section from an official-style path', () => {
    const meta = parseTimetableLocation(
      'https://www.lbrce.ac.in/cse/cse_timetables/2026-27/CSE_26-27_ODD_SEM/III_SEM/III_SEM_A_SEC_TT_AY_2026-27.jpg',
    );
    expect(meta.department).toBe('CSE');
    expect(meta.academicYear).toBe('2026-27');
    expect(meta.semester).toBe(3);
    expect(meta.year).toBe(2);
    expect(meta.section).toBe('A');
    expect(meta.term).toBe('odd');
  });
});

describe('timetable text extraction', () => {
  it('parses a synthetic pipe-delimited timetable and does not invent blank rows', () => {
    const entries = parseTimetableText(`SYNTHETIC FIXTURE — not a college record
Monday
1 | 09:00-09:50 | CS301 | Synthetic Subject | Example Faculty | C-101
2 | 09:50-10:40 | BREAK | Break | |
`);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      dayOfWeek: 'monday',
      periodNumber: 1,
      subjectCode: 'CS301',
      subjectName: 'Synthetic Subject',
      faculty: 'Example Faculty',
      room: 'C-101',
    });
    expect(entries[1]?.entryType).toBe('break');
  });

  it('maps spreadsheet headers', () => {
    const entries = entriesFromSpreadsheet(
      ['Day', 'Period', 'Subject code', 'Subject', 'Faculty', 'Room', 'Start time', 'End time'],
      [['Tuesday', '2', 'MA201', 'Synthetic Maths', 'Example Teacher', 'M-12', '10:00', '10:50']],
    );
    expect(entries[0]).toMatchObject({ dayOfWeek: 'tuesday', subjectCode: 'MA201', room: 'M-12' });
  });
});

describe('timetable resolution', () => {
  const today = '2026-10-09';

  it('asks for the section when several sections match', () => {
    const result = resolveTimetableQuery(
      { department: 'CSE', year: 2, semester: 3, today },
      [base({ id: 'a', section: 'A' }), base({ id: 'b', section: 'B' })],
    );
    expect(result.status).toBe('clarify');
    if (result.status === 'clarify') expect(result.options).toEqual(['Section A', 'Section B']);
  });

  it('returns the valid verified timetable for a specific class and day', () => {
    const result = resolveTimetableQuery(
      { department: 'CSE', year: 2, semester: 3, section: 'A', day: 'monday', today },
      [base({})],
    );
    expect(result.status).toBe('match');
    if (result.status === 'match') {
      expect(result.timetable.entries).toHaveLength(1);
      expect(result.verificationStatus).toBe('verified');
    }
  });

  it('prefers the latest verified record and reports a subject conflict', () => {
    const older = base({
      id: 'old',
      effectiveFrom: '2026-07-01',
      entries: [
        {
          dayOfWeek: 'monday',
          periodNumber: 1,
          subjectName: 'Older Subject',
          entryType: 'lecture',
          confidence: 0.8,
        },
      ],
    });
    const newer = base({
      id: 'new',
      effectiveFrom: '2026-09-01',
      updatedAt: '2026-09-02',
      entries: [
        {
          dayOfWeek: 'monday',
          periodNumber: 1,
          subjectName: 'Newer Subject',
          entryType: 'lecture',
          confidence: 0.8,
        },
      ],
    });
    const result = resolveTimetableQuery(
      { department: 'CSE', year: 2, semester: 3, section: 'A', today },
      [older, newer],
    );
    expect(result.status).toBe('match');
    if (result.status === 'match') {
      expect(result.timetable.id).toBe('new');
      expect(result.verificationStatus).toBe('conflict');
      expect(result.conflictNote).toMatch(/different subjects/);
    }
  });

  it('does not present an expired timetable as current', () => {
    const result = resolveTimetableQuery(
      { department: 'CSE', year: 2, semester: 3, section: 'A', today },
      [base({ effectiveFrom: '2024-07-01', effectiveUntil: '2024-11-30', academicYear: '2024-25' })],
    );
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.note).toMatch(/may be outdated/);
  });

  it('shows the latest academic year when the class is fully specified', () => {
    const result = resolveTimetableQuery(
      { department: 'CSE', year: 2, semester: 3, section: 'A', today },
      [
        base({ id: 'old', academicYear: '2025-26', effectiveFrom: undefined, effectiveUntil: undefined, entries: [] }),
        base({ id: 'current', academicYear: '2026-27', effectiveFrom: undefined, effectiveUntil: undefined, entries: [] }),
      ],
    );
    expect(result.status).toBe('match');
    if (result.status === 'match') {
      expect(result.timetable.id).toBe('current');
      expect(result.note).toMatch(/2026-27/);
      expect(result.note).toMatch(/2025-26/);
    }
  });

  it('reports missing timetable data', () => {
    expect(resolveTimetableQuery({ department: 'ECE', today }, [base({})]).status).toBe('none');
  });
});
