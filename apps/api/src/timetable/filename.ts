import { matchDepartment } from '@lbrce/shared';

const ROMAN: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
};

export interface TimetableMeta {
  department?: string;
  academicYear?: string;
  semester?: number;
  year?: number;
  section?: string;
  term?: 'odd' | 'even';
  confidence: number;
}

export function yearFromSemester(semester: number): number {
  return Math.ceil(semester / 2);
}

export function parseTimetableLocation(url: string): TimetableMeta {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url;
  }
  const meta: TimetableMeta = { confidence: 0.35 };
  const department = matchDepartment(decoded.replace(/[_./-]+/g, ' '));
  if (department) {
    meta.department = department.code;
    meta.confidence += 0.2;
  }

  const fullYear = decoded.match(/(20\d{2})\s*[-–]\s*(\d{2,4})/);
  if (fullYear?.[1] && fullYear[2]) {
    meta.academicYear = `${fullYear[1]}-${fullYear[2].slice(-2)}`;
    meta.confidence += 0.15;
  } else {
    const shortYear = decoded.match(/(?:^|[^\d])(\d{2})\s*[-–]\s*(\d{2})(?:[^\d]|$)/);
    if (shortYear?.[1] && shortYear[2]) {
      meta.academicYear = `20${shortYear[1]}-${shortYear[2]}`;
      meta.confidence += 0.1;
    }
  }

  const semester = decoded.match(/\b(viii|vii|iii|ii|iv|vi|v|i)\s*[_ -]?sem/i);
  if (semester?.[1]) {
    meta.semester = ROMAN[semester[1].toLowerCase()];
    if (meta.semester) meta.year = yearFromSemester(meta.semester);
    meta.confidence += 0.15;
  }

  const section = decoded.match(/(?:^|[^A-Za-z])([A-Za-z])_SEC(?:[^A-Za-z]|$)/);
  if (section?.[1]) {
    meta.section = section[1].toUpperCase();
    meta.confidence += 0.1;
  }

  const lower = decoded.toLowerCase();
  if (lower.includes('odd')) meta.term = 'odd';
  if (lower.includes('even')) meta.term = 'even';
  if (/timetable|time-table|_tt_|\/tt/i.test(decoded)) meta.confidence += 0.05;
  return meta;
}

export function looksLikeTimetableAsset(url: string): boolean {
  return /timetable|time-table|_tt_|\/tt/i.test(url) && /\.(pdf|xlsx|xls|csv|docx|jpe?g|png|webp)(\?|$)/i.test(url);
}
