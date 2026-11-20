import { describe, expect, it } from 'vitest';
import { groundedIntake, groundedPhrase } from './compare.js';
import { lineHasCorruptDate, linesForRegulation, validPrintedDate } from './calendar-text.js';

const CALENDAR = `
--- page 1 ---
Regulations: R26 AY. 2026-27
Commencement of Class Work 10-08-2026
Dasara Holidays iot0206 | 210206 | 3D
--- page 3 ---
Regulations: R23
Commencement of Class Work 13-07-2026
MID Examinations oM02028
`;

describe('calendar regulation text', () => {
  it('keeps a real date and rejects a corrupted one', () => {
    expect(validPrintedDate('10-08-2026')).toBe('10-08-2026');
    expect(validPrintedDate('iot0206')).toBeNull();
    expect(lineHasCorruptDate('Dasara Holidays iot0206')).toBe(true);
    expect(lineHasCorruptDate('Commencement of Class Work 10-08-2026')).toBe(false);
  });

  it('returns only the selected regulation', () => {
    const lines = linesForRegulation(CALENDAR, 'R26');
    expect(lines).toEqual(['Commencement of Class Work 10-08-2026']);
    expect(lines.join(' ')).not.toContain('13-07-2026');
    expect(lines.join(' ')).not.toContain('R23');
  });
});

describe('comparison figures', () => {
  it('keeps a number only when that page contains it', () => {
    const page = 'The department was established in 1998 and has an intake of 60 students.';
    expect(groundedPhrase(page, /established in \d{4}/i)).toBe('established in 1998');
    expect(groundedIntake(page)).toBe('intake of 60 students');
    expect(groundedIntake('started with an intake of 40 students and the intake was subsequently increased to 60 students.')).toBe(
      'intake of 40 students and the intake was subsequently increased to 60 students',
    );
    expect(groundedPhrase('No intake is printed.', /intake of \d{1,4} students/i)).toBe('');
    expect(groundedPhrase('established in 1998', /established in \d{4}/i)).toBe('established in 1998');
  });
});
