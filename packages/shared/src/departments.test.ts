import { describe, expect, it } from 'vitest';
import { matchDepartment } from './departments';

describe('matchDepartment', () => {
  it('prefers the longer CSE AI&ML alias over CSE', () => {
    expect(matchDepartment('Show CSE (AI&ML) faculty')?.code).toBe('CSE (AI&ML)');
  });

  it('matches civil engineering without treating it as CSE', () => {
    expect(matchDepartment('head of civil engineering')?.code).toBe('CE');
  });

  it('maps the faculty-page label CSE(AI & ML) to CSE AI&ML', () => {
    expect(matchDepartment('CSE(AI & ML)')?.code).toBe('CSE (AI&ML)');
  });

  it('maps the faculty-page label MECH to mechanical engineering', () => {
    expect(matchDepartment('MECH')?.code).toBe('ME');
  });

  it('returns undefined when no department is mentioned', () => {
    expect(matchDepartment('what is the academic calendar')).toBeUndefined();
  });
});
