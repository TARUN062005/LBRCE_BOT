import { matchDepartment } from '@lbrce/shared';
import { normalizeWeekday, weekdayInKolkata } from '../utils/time.js';

export type IntentType =
  | 'timetable'
  | 'faculty'
  | 'department'
  | 'calendar'
  | 'examination'
  | 'admission'
  | 'fee'
  | 'placement'
  | 'image'
  | 'notice'
  | 'summary'
  | 'general';

export interface QueryEntities {
  department?: string;
  departmentName?: string;
  year?: number;
  semester?: number;
  section?: string;
  day?: string;
  academicYear?: string;
}

const YEAR_WORDS: Record<string, number> = {
  first: 1,
  '1st': 1,
  i: 1,
  second: 2,
  '2nd': 2,
  ii: 2,
  third: 3,
  '3rd': 3,
  iii: 3,
  fourth: 4,
  '4th': 4,
  iv: 4,
};

export function detectIntent(message: string): { type: IntentType; wantsImages: boolean } {
  const text = message.toLowerCase();
  const wantsImages = /\b(photo|photograph|image|picture|gallery|campus)\b/.test(text);
  if (/\b(timetable|time table|schedule for|today's class|todays class)\b/.test(text)) return { type: 'timetable', wantsImages };
  if (/\b(hod|head of|faculty|professor|staff)\b/.test(text)) return { type: 'faculty', wantsImages };
  if (/\b(department|programme|program|courses offered|what departments)\b/.test(text)) return { type: 'department', wantsImages };
  if (/\b(academic\s+cal[ae]nd[ae]r|cal[ae]nd[ae]r|sankranthi|sankranti|pongal|holidays?)\b/.test(text)) return { type: 'calendar', wantsImages };
  if (/\b(exam|examination|results announcement|circular)\b/.test(text)) return { type: 'examination', wantsImages };
  if (/\b(admission|eapcet|icet|eligibility)\b/.test(text)) return { type: 'admission', wantsImages };
  if (/\b(fee|tuition)\b/.test(text)) return { type: 'fee', wantsImages };
  if (/\b(placement|placed|recruiter)\b/.test(text)) return { type: 'placement', wantsImages };
  if (/\b(notice|notification)\b/.test(text)) return { type: 'notice', wantsImages };
  if (wantsImages) return { type: 'image', wantsImages };
  if (/\b(summarize|summary)\b/.test(text)) return { type: 'summary', wantsImages };
  return { type: 'general', wantsImages };
}

export function extractEntities(message: string, now = new Date()): QueryEntities {
  const entities: QueryEntities = {};
  const department = matchDepartment(message);
  if (department) {
    entities.department = department.code;
    entities.departmentName = department.name;
  } else if (/\bit\b/i.test(message) && /\b(faculty|timetable|department|hod|semester|year|section)\b/i.test(message)) {
    entities.department = 'IT';
    entities.departmentName = 'Information Technology';
  }

  const yearMatch = message.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th|i{1,3}|iv)\s*(?:year|yr)\b/i);
  if (yearMatch?.[1]) entities.year = YEAR_WORDS[yearMatch[1].toLowerCase()];

  const absoluteSemester = message.match(/\b(?:semester|sem)\s*(viii|vii|iii|ii|iv|vi|v|i|\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+semester\b/i);
  const relativeSemester = message.match(/\b(first|second|1st|2nd)\s+semester\b/i);
  if (absoluteSemester && !relativeSemester) {
    const token = (absoluteSemester[1] ?? absoluteSemester[2] ?? '').toLowerCase();
    const semester = YEAR_WORDS[token] ?? Number(token);
    if (semester >= 1 && semester <= 8) {
      entities.semester = semester;
      entities.year ??= Math.ceil(semester / 2);
    }
  } else if (relativeSemester?.[1] && entities.year) {
    const relative = /first|1st/i.test(relativeSemester[1]) ? 1 : 2;
    entities.semester = (entities.year - 1) * 2 + relative;
  } else if (absoluteSemester) {
    const token = (absoluteSemester[1] ?? absoluteSemester[2] ?? '').toLowerCase();
    const semester = YEAR_WORDS[token] ?? Number(token);
    if (semester) entities.semester = semester;
  }

  const section = message.match(/\b(?:section|sec)\s*([a-z])\b/i);
  if (section?.[1]) entities.section = section[1].toUpperCase();

  const academicYear = message.match(/\b(20\d{2})\s*[-–/]\s*(\d{2,4})\b/);
  if (academicYear?.[1] && academicYear[2]) entities.academicYear = `${academicYear[1]}-${academicYear[2].slice(-2)}`;

  if (/\btoday\b/i.test(message)) entities.day = weekdayInKolkata(now);
  else if (/\btomorrow\b/i.test(message)) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    entities.day = weekdayInKolkata(tomorrow);
  } else {
    const day = message.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (day?.[1]) entities.day = normalizeWeekday(day[1]);
  }
  return entities;
}

export function documentTypeForIntent(intent: IntentType): string | undefined {
  switch (intent) {
    case 'timetable':
      return 'timetable';
    case 'calendar':
      return 'calendar';
    case 'examination':
      return 'circular';
    case 'admission':
      return 'other';
    case 'fee':
      return 'fee';
    case 'placement':
      return 'placement';
    case 'notice':
      return 'notice';
    case 'faculty':
      return 'faculty';
    default:
      return undefined;
  }
}
