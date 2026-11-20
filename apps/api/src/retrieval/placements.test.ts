import { describe, expect, it } from 'vitest';
import { peopleFromPlacementContact, personForAsk, placementAnswerMarkdown, placementAsk } from './placements.js';

const PAGE = `
Dr. V SURYANARAYANA Dean - Industrial Relations Phone: 9849787518 & 9494596818 E-Mail: dean@lbrce.ac.in
Dr. Sujit Kumar Rath Training and Placement Officer Phone: 8919482365 & 812529489 E-Mail: [email protected] ,in
Mr. L. Venu Gopal Placement Officer Phone: 9505611333 E-Mail: officer@lbrce.ac.in
Ms. D. Venkata Lakshmi Assistant TPO Phone: 8179973853 E-Mail: assistant@lbrce.ac.in
`;

describe('placements team page', () => {
  const people = peopleFromPlacementContact(PAGE);

  it('reads the four printed roles and does not rewrite a broken email line', () => {
    expect(people.map((person) => person.designation)).toEqual([
      'Dean - Industrial Relations',
      'Training and Placement Officer',
      'Placement Officer',
      'Assistant TPO',
    ]);
    expect(personForAsk(people, 'tpo')?.name).toBe('Dr. Sujit Kumar Rath');
    expect(personForAsk(people, 'placement-officer')?.name).toBe('Mr. L. Venu Gopal');
    expect(personForAsk(people, 'dean')?.name).toContain('SURYANARAYANA');
    const answer = placementAnswerMarkdown('tpo', people);
    expect(answer).toContain('Dr. Sujit Kumar Rath');
    expect(answer).toContain('not corrected');
    expect(answer).not.toContain('Head of the Department');
  });

  it('does not treat the placement officer question as the training and placement officer', () => {
    expect(placementAsk('Who is the current Training and Placement Officer?')).toBe('tpo');
    expect(placementAsk('Who is the Placement Officer?')).toBe('placement-officer');
    expect(placementAsk('Who is the current Head of TP Cell?')).toBe('head');
    expect(placementAnswerMarkdown('head', people)).toContain('does not print the title');
    expect(placementAnswerMarkdown('placement-officer', people)).toContain('Mr. L. Venu Gopal');
    expect(placementAnswerMarkdown('placement-officer', people)).not.toContain('Sujit Kumar Rath');
  });
});
