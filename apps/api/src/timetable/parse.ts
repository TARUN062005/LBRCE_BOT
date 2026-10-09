export interface ParsedEntry {
  dayOfWeek: string;
  periodNumber?: number;
  startTime?: string;
  endTime?: string;
  subjectCode?: string;
  subjectName?: string;
  faculty?: string;
  room?: string;
  entryType: 'lecture' | 'lab' | 'break' | 'free' | 'other';
  confidence: number;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function entryTypeFor(subject: string): ParsedEntry['entryType'] {
  const text = subject.toLowerCase();
  if (/\b(break|lunch|recess)\b/.test(text)) return 'break';
  if (/\b(free|library)\b/.test(text)) return 'free';
  if (/\b(lab|laboratory|practical)\b/.test(text)) return 'lab';
  return 'lecture';
}

function clean(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text : undefined;
}

/**
 * Parses explicit timetable lines. This does not guess missing cells.
 * Supported synthetic and extracted shapes:
 *   Monday | 1 | 09:00-09:50 | CS101 | Data Structures | Dr. Example | C-101
 */
export function parseTimetableText(text: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let currentDay: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const dayOnly = line.match(/^(?:day\s*[:-]\s*)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (dayOnly && line.length < 40 && !/\d{1,2}:\d{2}/.test(line)) {
      currentDay = dayOnly[1]?.toLowerCase();
      continue;
    }

    const time = line.match(/(\d{1,2}[:.]\d{2})\s*[-–to]{1,3}\s*(\d{1,2}[:.]\d{2})/i);
    const parts = line.split(/\s*\|\s*/).map((part) => part.trim()).filter(Boolean);
    const inlineDay = line.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i);
    const day = normalizeDayToken(inlineDay?.[1]) ?? currentDay;
    if (!day || !time) continue;

    let period: number | undefined;
    let subjectCode: string | undefined;
    let subjectName: string | undefined;
    let faculty: string | undefined;
    let room: string | undefined;

    if (parts.length >= 4) {
      const periodToken = parts.find((part) => /^\d{1,2}$/.test(part));
      if (periodToken) period = Number(periodToken);
      const code = parts.find((part) => /^[A-Z]{2,6}\d{2,4}[A-Z]?$/i.test(part));
      subjectCode = code;
      const named = parts.filter(
        (part) =>
          part !== periodToken &&
          part !== code &&
          !/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(part) &&
          !/\d{1,2}[:.]\d{2}/.test(part),
      );
      subjectName = named[0];
      faculty = named[1];
      room = named[2];
    } else {
      const periodMatch = line.match(/\bperiod\s*(\d{1,2})\b|\b(\d{1,2})\s*(?=\d{1,2}[:.]\d{2})/i);
      period = Number(periodMatch?.[1] ?? periodMatch?.[2] ?? '') || undefined;
      const code = line.match(/\b([A-Z]{2,6}\d{2,4}[A-Z]?)\b/);
      subjectCode = code?.[1];
      const facultyMatch = line.match(/faculty\s*[:-]\s*([^|]+?)(?=\s+room\s*[:-]|$)/i);
      const roomMatch = line.match(/room\s*[:-]\s*([A-Z0-9-]+)/i);
      faculty = facultyMatch?.[1];
      room = roomMatch?.[1];
      if (subjectCode) {
        const after = line.split(subjectCode)[1] ?? '';
        subjectName = after.split(/faculty\s*:|room\s*:/i)[0];
      }
    }

    const subject = clean(subjectName) ?? clean(subjectCode);
    if (!subject) continue;
    entries.push({
      dayOfWeek: day,
      periodNumber: period,
      startTime: time[1]?.replace('.', ':'),
      endTime: time[2]?.replace('.', ':'),
      subjectCode: clean(subjectCode),
      subjectName: clean(subjectName) ?? clean(subjectCode),
      faculty: clean(faculty),
      room: clean(room),
      entryType: entryTypeFor(subject),
      confidence: parts.length >= 5 ? 0.72 : 0.55,
    });
  }
  return entries;
}

function normalizeDayToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const value = token.toLowerCase();
  return DAYS.find((day) => day === value || day.startsWith(value));
}

export function entriesFromSpreadsheet(headers: string[], rows: string[][]): ParsedEntry[] {
  const index = new Map(headers.map((header, position) => [header.toLowerCase().replace(/[^a-z]/g, ''), position]));
  const pick = (row: string[], keys: string[]) => {
    for (const key of keys) {
      const position = index.get(key);
      if (position !== undefined) return row[position];
    }
    return undefined;
  };
  const entries: ParsedEntry[] = [];
  for (const row of rows) {
    const day = normalizeDayToken(pick(row, ['day', 'dayofweek', 'weekday']));
    const subject = clean(pick(row, ['subject', 'subjectname', 'course']));
    if (!day || !subject) continue;
    const time = `${pick(row, ['starttime', 'from']) ?? ''} ${pick(row, ['time', 'periodtime']) ?? ''}`;
    const range = time.match(/(\d{1,2}[:.]\d{2})\s*[-–to]{1,3}\s*(\d{1,2}[:.]\d{2})/);
    entries.push({
      dayOfWeek: day,
      periodNumber: Number(pick(row, ['period', 'periodnumber']) ?? '') || undefined,
      startTime: range?.[1]?.replace('.', ':') ?? clean(pick(row, ['starttime', 'from'])),
      endTime: range?.[2]?.replace('.', ':') ?? clean(pick(row, ['endtime', 'to'])),
      subjectCode: clean(pick(row, ['subjectcode', 'code'])),
      subjectName: subject,
      faculty: clean(pick(row, ['faculty', 'facultyname', 'teacher'])),
      room: clean(pick(row, ['room', 'classroom', 'venue'])),
      entryType: entryTypeFor(subject),
      confidence: 0.8,
    });
  }
  return entries;
}
