import { DEPARTMENT_MATCHERS, matchDepartment } from '@lbrce/shared';
import { detectIntent, type QueryEntities } from './intent.js';

export const FULL_FACULTY_LIST = 'Show the full department list';

const FACULTY_WORD = /\b(faculty|professors?|hod|head of|staff)\b/i;

const STOP = new Set(
  'need details detail about faculty professor prof professors dr department dept show tell who is the of me please give fetch information info lbrce college staff member what which their there from for and with can you want looking search person people named name full list everyone all step'.split(
    ' ',
  ),
);

const DEPARTMENT_WORDS = new Set(
  DEPARTMENT_MATCHERS.flatMap((matcher) => [matcher.code, matcher.name, ...matcher.patterns])
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9&]+/))
    .filter((word) => word.length > 1),
);

export type FacultyStep = { kind: 'department' } | { kind: 'person'; departmentCode: string; departmentName: string };

export type FacultyPlan =
  | { action: 'ask-department' }
  | { action: 'ask-person'; departmentCode: string; departmentName: string }
  | { action: 'continue-department' }
  | { action: 'continue-person'; departmentCode: string; departmentName: string }
  | { action: 'named'; tokens: string[]; departmentCode?: string }
  | { action: 'list'; departmentCode?: string; headsOnly: boolean };

export function departmentQuestion(): string {
  return 'Step 1 of 2. Which department do you want faculty details for?';
}

export function personQuestion(departmentName: string, departmentCode: string): string {
  return `Step 2 of 2. Which faculty member in ${departmentName}? [${departmentCode}]`;
}

export function readFacultyStep(blocks: unknown): FacultyStep | undefined {
  if (!Array.isArray(blocks)) return undefined;
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const record = block as { type?: string; question?: string };
    if (record.type !== 'clarification' || !record.question) continue;
    if (record.question.includes('Which department do you want faculty details for?')) return { kind: 'department' };
    const named = record.question.match(/Which faculty member in ([^?]+)\? \[([^\]]+)\]/);
    if (named?.[2]) {
      const department = matchDepartment(named[2]);
      return {
        kind: 'person',
        departmentCode: department?.code ?? named[2],
        departmentName: named[1]?.trim() || department?.name || named[2],
      };
    }
  }
  return undefined;
}

export function shouldContinueFaculty(message: string, prior: FacultyStep | undefined): boolean {
  if (!prior || FACULTY_WORD.test(message)) return false;
  const intent = detectIntent(message).type;
  if (intent !== 'general' && intent !== 'department') return false;
  if (/\?/.test(message) && !departmentFromReply(message) && !wantsFullFacultyList(message)) return false;
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed.length <= 120;
}

export function planFacultyQuestion(message: string, entities: QueryEntities, prior?: FacultyStep): FacultyPlan {
  const fresh = FACULTY_WORD.test(message);
  if (!fresh && prior?.kind === 'department') return { action: 'continue-department' };
  if (!fresh && prior?.kind === 'person') {
    return { action: 'continue-person', departmentCode: prior.departmentCode, departmentName: prior.departmentName };
  }
  const headsOnly = /\b(hod|head of)\b/i.test(message);
  if (headsOnly) return entities.department ? { action: 'list', departmentCode: entities.department, headsOnly: true } : { action: 'ask-department' };
  const tokens = personTokens(message);
  if (tokens.length) return { action: 'named', tokens, departmentCode: entities.department };
  const wantsList = /\b(list|everyone|entire)\b/i.test(message) || (/\bshow\b/i.test(message) && Boolean(entities.department));
  if (wantsList) return entities.department ? { action: 'list', departmentCode: entities.department, headsOnly: false } : { action: 'ask-department' };
  if (!entities.department) return { action: 'ask-department' };
  return { action: 'ask-person', departmentCode: entities.department, departmentName: entities.departmentName ?? entities.department };
}

export function personTokens(message: string): string[] {
  return [
    ...new Set(
      [...message.toLowerCase().matchAll(/\b[a-z][a-z.]{2,}\b/g)]
        .map((match) => match[0].replace(/\./g, ''))
        .filter((token) => token.length > 2 && !STOP.has(token) && !DEPARTMENT_WORDS.has(token)),
    ),
  ];
}

export function wantsFullFacultyList(message: string): boolean {
  return message.trim().toLowerCase() === FULL_FACULTY_LIST.toLowerCase() || /\b(full list|everyone|all faculty)\b/i.test(message);
}

export function departmentFromReply(message: string): { code: string; name: string } | undefined {
  return matchDepartment(message);
}
