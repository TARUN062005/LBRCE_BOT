/**
 * Aliases used only to understand a user's question.
 * Department records shown to users must come from retrieved sources.
 * Names match programmes listed on the public LBRCE courses page.
 */
export interface DepartmentMatcher {
  code: string;
  name: string;
  patterns: string[];
}

export const DEPARTMENT_MATCHERS: DepartmentMatcher[] = [
  { code: 'ASE', name: 'Aerospace Engineering', patterns: ['aerospace', 'ase'] },
  {
    code: 'AI&DS',
    name: 'Artificial Intelligence and Data Science',
    patterns: ['ai&ds', 'ai & ds', 'aids', 'artificial intelligence and data science', 'artificial intelligence & data science'],
  },
  { code: 'CE', name: 'Civil Engineering', patterns: ['civil engineering', 'civil', 'ce'] },
  {
    code: 'CSE (AI&ML)',
    name: 'Computer Science and Engineering (AI & ML)',
    patterns: [
      'cse (ai&ml)',
      'cse(ai&ml)',
      'cse (ai & ml)',
      'cse(ai & ml)',
      'cse ai&ml',
      'cse ai ml',
      'csm',
      'artificial intelligence & machine learning',
      'artificial intelligence and machine learning',
    ],
  },
  {
    code: 'CSE',
    name: 'Computer Science and Engineering',
    patterns: ['computer science and engineering', 'computer science & engineering', 'cse'],
  },
  {
    code: 'EEE',
    name: 'Electrical and Electronics Engineering',
    patterns: ['electrical and electronics', 'electrical & electronics', 'eee'],
  },
  {
    code: 'ECE',
    name: 'Electronics and Communication Engineering',
    patterns: ['electronics and communication', 'electronics & communication', 'ece'],
  },
  {
    code: 'EIE',
    name: 'Electronics and Instrumentation Engineering',
    patterns: ['electronics and instrumentation', 'instrumentation', 'eie'],
  },
  {
    code: 'IT',
    name: 'Information Technology',
    patterns: ['information technology', 'it department', 'department of it', 'dept of it'],
  },
  { code: 'ME', name: 'Mechanical Engineering', patterns: ['mechanical engineering', 'mechanical', 'mech department', 'mech'] },
  { code: 'MBA', name: 'Master of Business Administration', patterns: ['mba', 'business administration'] },
  { code: 'MCA', name: 'Master of Computer Applications', patterns: ['mca', 'computer applications'] },
  { code: 'FED', name: 'Freshman Engineering Department', patterns: ['freshman', 'fed'] },
];

export function matchDepartment(text: string): { code: string; name: string } | undefined {
  const haystack = ` ${text.toLowerCase().replace(/[._/]+/g, ' ')} `;
  let best: { code: string; name: string; length: number } | undefined;
  for (const matcher of DEPARTMENT_MATCHERS) {
    for (const pattern of matcher.patterns) {
      const needle = pattern.toLowerCase();
      if (haystack.includes(needle) && (!best || needle.length > best.length)) {
        best = { code: matcher.code, name: matcher.name, length: needle.length };
      }
    }
  }
  return best ? { code: best.code, name: best.name } : undefined;
}
