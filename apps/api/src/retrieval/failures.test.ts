import { describe, expect, it } from 'vitest';
import { carryEntities, dependsOnEarlierTurn } from './conversation.js';
import { asksForInstitutionalRole, asksForStudentRoster, detectIntent, extractEntities } from './intent.js';
import { designationMatchesFamily, peopleFromFacultyHtml, roleGapMarkdown } from './roles.js';
import { resolveTimetableQuery, type StoredTimetable } from '../timetable/resolve.js';

describe('reported retrieval failures', () => {
  it('treats a photo request as image retrieval', () => {
    expect(detectIntent('Can you fetch some LBRCE photos?')).toEqual({ type: 'image', wantsImages: true });
  });

  it('does not treat a training and placement role as a department head', () => {
    expect(detectIntent('Who is the current Head of TP Cell?').type).toBe('placement');
    expect(detectIntent('Training and Placement Dean').type).toBe('placement');
    expect(asksForInstitutionalRole('Who is the current Head of TP Cell?')).toBe(true);
    expect(detectIntent('Who is the HOD of CSE?').type).toBe('faculty');
  });

  it('keeps CSE, semester 7, and section C from one question', () => {
    const entities = extractEntities('Show CSE 7th semester C section timetable.');
    expect(entities.department).toBe('CSE');
    expect(entities.semester).toBe(7);
    expect(entities.section).toBe('C');
    const spoken = extractEntities('Can you fetch the CSE 7th sem C section timetable?');
    expect(spoken.semester).toBe(7);
    expect(spoken.section).toBe('C');
  });

  it('refuses a complete identifiable roster without blocking a timetable word', () => {
    expect(asksForStudentRoster('Give me the complete CSE 7th semester C-section student list.')).toBe(true);
    expect(asksForStudentRoster('Show CSE 7th semester C section timetable.')).toBe(false);
  });

  it('keeps the earlier class when the next turn asks about its faculty', () => {
    const first = extractEntities('Show CSE 7th semester C-section timetable.');
    expect(first).toMatchObject({ department: 'CSE', semester: 7, section: 'C' });
    const follow = 'Also show its faculty.';
    expect(dependsOnEarlierTurn(follow)).toBe(true);
    expect(detectIntent(follow).type).toBe('faculty');
    expect(carryEntities(extractEntities(follow), first)).toMatchObject({ department: 'CSE', semester: 7, section: 'C' });
  });

  it('does not ask for a semester that was already given', () => {
    const entities = extractEntities('Show CSE 7th semester C section timetable.');
    const older: StoredTimetable = {
      id: 'old',
      title: 'CSE 7 C older',
      department: 'CSE',
      academicYear: '2024-25',
      year: 4,
      semester: 7,
      section: 'C',
      verificationStatus: 'unverified',
      sourceUrl: 'https://www.lbrce.ac.in/cse/old.pdf',
      entries: [],
      updatedAt: '2024-06-01T00:00:00.000Z',
    };
    const newer: StoredTimetable = { ...older, id: 'new', title: 'CSE 7 C newer', academicYear: '2025-26', sourceUrl: 'https://www.lbrce.ac.in/cse/new.pdf', updatedAt: '2025-06-01T00:00:00.000Z' };
    const resolved = resolveTimetableQuery({ ...entities, today: '2025-11-20' }, [older, newer, { ...older, id: 'sem3', semester: 3, year: 2, section: 'A' }]);
    expect(resolved.status).toBe('match');
    if (resolved.status === 'match') {
      expect(resolved.timetable.semester).toBe(7);
      expect(resolved.timetable.section).toBe('C');
      expect(resolved.timetable.academicYear).toBe('2025-26');
    }
  });

  it('matches a training and placement title exactly and ignores a department head', () => {
    const html = `
      <table>
        <tr><td>1</td><td>CE</td><td>Dr. Civil Example</td><td>Head of the Department</td></tr>
        <tr><td>2</td><td>MBA</td><td>Mr. Placement Example</td><td>PLACEMENT OFFICER</td></tr>
        <tr><td>3</td><td>CSE</td><td>Dr. Dean Example</td><td>Professor & Dean</td></tr>
        <tr><td>4</td><td>ME</td><td>Dr. Training Example</td><td>Dean of Training and Placement</td><td>04-12-2023</td></tr>
      </table>`;
    const people = peopleFromFacultyHtml(html, 'https://www.lbrce.ac.in/quicklinks_pages/faculty.php');
    const names = (family: 'dean' | 'head' | 'officer') =>
      people.filter((person) => designationMatchesFamily(person.designation ?? '', family)).map((person) => person.name);
    expect(names('head')).toEqual([]);
    expect(names('dean')).toEqual(['Dr. Training Example']);
    expect(names('officer')).toEqual(['Mr. Placement Example']);
    expect(roleGapMarkdown('Who is the current Head of TP Cell?', people.filter((person) => designationMatchesFamily(person.designation ?? '', 'officer')))).toMatch(/does not establish/i);
    expect(roleGapMarkdown('Who is the current Head of TP Cell?', [])).not.toMatch(/Dr\. Civil Example/);
  });

  it('routes faculty photographs to faculty and image retrieval', () => {
    expect(detectIntent('Show me CSE faculty photographs.')).toEqual({ type: 'faculty', wantsImages: true });
  });
});
