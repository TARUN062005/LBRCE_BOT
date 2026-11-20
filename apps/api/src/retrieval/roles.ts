import type { FacultyRow } from './assemble.js';
import { asksForInstitutionalRole } from './intent.js';

export type RoleFamily = 'dean' | 'head' | 'officer';

const DEAN = /(?:\bdean\b.{0,40}(?:training\s*(?:and|&)\s*placement|t\s*&\s*p))|(?:(?:training\s*(?:and|&)\s*placement|t\s*&\s*p).{0,40}\bdean\b)|(?:\bplacement\s+dean\b)/i;
const HEAD = /\bhead(?:\s*,|\s+of(?:\s+the)?)?\s+(?:tp\s+cell|t\s*&\s*p(?:\s+cell)?|training\s*(?:and|&)\s*placement(?:\s+cell)?|placement\s+cell)\b/i;
const OFFICER = /\b(?:placement\s+officer|training\s*(?:and|&)\s*placement\s+(?:officer|coordinator)|t\s*&\s*p\s+(?:officer|coordinator)|placement\s+coordinator)\b/i;
const DEPARTMENT_HEAD = /\bhead of (?:the )?department\b|\bhod\b/i;

export function requestedRoleFamily(message: string): RoleFamily | null {
  if (!asksForInstitutionalRole(message)) return null;
  const text = message.toLowerCase();
  if (/\bdean\b/.test(text)) return 'dean';
  if (/\b(head|hod)\b/.test(text)) return 'head';
  if (/\b(officer|coordinator)\b/.test(text)) return 'officer';
  return null;
}

export function roleLabel(message: string): string {
  const family = requestedRoleFamily(message);
  if (family === 'dean') return 'Training and Placement Dean';
  if (family === 'head') return 'Head of the Training and Placement Cell';
  if (family === 'officer') return 'Training and Placement Officer';
  return 'training and placement role';
}

export function designationMatchesFamily(designation: string, family: RoleFamily): boolean {
  const value = designation.replace(/\s+/g, ' ').trim();
  if (!value) return false;
  if (family === 'dean') return DEAN.test(value);
  if (family === 'head') return HEAD.test(value) && !(DEPARTMENT_HEAD.test(value) && !/placement|t\s*&\s*p|tp\s+cell/i.test(value));
  return OFFICER.test(value);
}

export function isInstitutionalDesignation(designation: string): boolean {
  return (['dean', 'head', 'officer'] as const).some((family) => designationMatchesFamily(designation, family));
}

/** Evidence must contain the requested title, not a nearby department head or a different placement title. */
export function evidenceSupportsRequestedRole(message: string, evidence: string): boolean {
  const family = requestedRoleFamily(message);
  if (!family) return asksForInstitutionalRole(message) && isInstitutionalDesignation(evidence);
  return designationMatchesFamily(evidence, family);
}

export function peopleFromFacultyHtml(html: string, sourceUrl: string): FacultyRow[] {
  const people: FacultyRow[] = [];
  const seen = new Set<string>();
  for (const row of html.split(/<tr\b/i)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => cleanCell(match[1] ?? ''))
      .filter(Boolean);
    const name = cells.find((cell) => /^(?:mr|mrs|ms|dr)\.?\s+[a-z]/i.test(cell) && cell.length < 80);
    const designation = cells.find((cell) => /\b(?:professor|associate|assistant|head|dean|officer|hod|coordinator|lecturer)\b/i.test(cell));
    if (!name || !designation) continue;
    const key = `${name.toLowerCase()}|${designation.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const department = cells.find((cell) => /^(?:cse|cse \(ai&ml\)|ece|eee|eie|it|ce|civil|me|mech|ase|ai&ds|aids|mba|mca|csm)$/i.test(cell));
    const listedOn = cells.find((cell) => /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(cell));
    people.push({
      name,
      designation,
      department: department?.toUpperCase(),
      sourceUrl,
      listedOn,
      verificationStatus: 'unverified',
    });
  }
  return people;
}

export function roleAnswerMarkdown(person: FacultyRow, extra?: string): string {
  const lines = [
    `**${person.name}** is listed with the exact designation **${person.designation || 'not printed'}**.`,
    person.department ? `Department printed on the row: ${person.department}.` : 'No department is printed on that row.',
    person.listedOn ? `Date printed on the row: ${person.listedOn}. That date is not treated as proof that the role is current.` : 'The faculty row does not print a last-verified date.',
    person.sourceUrl ? `[Official faculty list](${person.sourceUrl})` : '',
    extra ?? '',
  ];
  return lines.filter(Boolean).join('\n\n');
}

export function roleGapMarkdown(message: string, related: FacultyRow[] = []): string {
  const label = roleLabel(message);
  const lines = [
    `The official faculty list does not establish who currently holds “${label}”.`,
    'A department head is not an answer to this question, and a different placement title is not treated as the same person.',
    'No last-verified date for this role is published on the faculty list.',
  ];
  const other = related.filter((person) => person.designation && !evidenceSupportsRequestedRole(message, person.designation));
  if (other.length) {
    lines.push('The same official list includes a different designation:');
    for (const person of other.slice(0, 3)) {
      lines.push(
        `- **${person.name}** — exact designation: ${person.designation}${person.department ? `; department: ${person.department}` : ''}. This is not “${label}”.`,
      );
    }
    if (other[0]?.sourceUrl) lines.push(`[Official faculty list](${other[0].sourceUrl})`);
  }
  return lines.join('\n\n');
}

function cleanCell(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
