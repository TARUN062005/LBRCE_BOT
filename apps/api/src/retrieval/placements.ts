const SOURCE = 'https://www.lbrce.ac.in/placements/placementcontact.php';

export interface PlacementPerson {
  name: string;
  designation: string;
  phone: string;
  emailLine: string;
  sourceUrl: string;
}

const DESIGNATION =
  'Dean - Industrial Relations|Training and Placement Officer|Placement Officer|Assistant TPO';

export function peopleFromPlacementContact(html: string, sourceUrl = SOURCE): PlacementPerson[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#160;|&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const pattern = new RegExp(
    `(Dr\\.|Mr\\.|Ms\\.|Mrs\\.)\\s+([A-Za-z][A-Za-z.\\s]+?)\\s+(${DESIGNATION})\\s+Phone:\\s*([^E]+?)\\s+E-Mail:\\s*(.*?)(?=(?:Dr\\.|Mr\\.|Ms\\.|Mrs\\.)\\s+[A-Z]|@ All|$)`,
    'gi',
  );
  const people: PlacementPerson[] = [];
  for (const match of text.matchAll(pattern)) {
    const name = `${match[1]} ${cleanup(match[2] ?? '')}`.replace(/\s+/g, ' ').trim();
    const designation = cleanup(match[3] ?? '');
    if (!name || !designation) continue;
    people.push({
      name,
      designation,
      phone: cleanup(match[4] ?? ''),
      emailLine: cleanup(match[5] ?? ''),
      sourceUrl,
    });
  }
  return people;
}

export type PlacementAsk = 'tpo' | 'placement-officer' | 'assistant-tpo' | 'dean' | 'head';

export function placementAsk(message: string): PlacementAsk | null {
  const text = message.toLowerCase();
  if (!/\b(placement|tpo|t\s*&\s*p|training\s+and\s+placement|industrial relations|tp cell)\b/.test(text)) return null;
  if (/\bassistant\s+tpo\b|\bassistant\s+training\b/.test(text)) return 'assistant-tpo';
  if (/\btraining\s+and\s+placement\s+officer\b|\btpo\b/.test(text)) return 'tpo';
  if (/\bplacement\s+officer\b/.test(text)) return 'placement-officer';
  if (/\bdean\b/.test(text)) return 'dean';
  if (/\b(head|hod)\b/.test(text)) return 'head';
  return null;
}

export function personForAsk(people: PlacementPerson[], ask: PlacementAsk): PlacementPerson | undefined {
  if (ask === 'tpo') return people.find((person) => person.designation === 'Training and Placement Officer');
  if (ask === 'placement-officer') return people.find((person) => person.designation === 'Placement Officer');
  if (ask === 'assistant-tpo') return people.find((person) => person.designation === 'Assistant TPO');
  if (ask === 'dean') return people.find((person) => /dean/i.test(person.designation) && /industrial/i.test(person.designation));
  return undefined;
}

export function placementAnswerMarkdown(ask: PlacementAsk, people: PlacementPerson[]): string {
  const person = personForAsk(people, ask);
  if (ask === 'head') {
    const tpo = personForAsk(people, 'tpo');
    return [
      'The official Placements Team page does not print the title “Head of TP Cell”.',
      tpo
        ? `It does name **${tpo.name}** as **${tpo.designation}**. That printed title is not rewritten as Head of TP Cell.`
        : 'It also does not name a Head of TP Cell.',
      'A department head from the general faculty list is not used for this role.',
      `[Placements team](${SOURCE})`,
    ].join('\n\n');
  }
  if (!person) {
    return `The official Placements Team page does not name that role.\n\n[Placements team](${SOURCE})`;
  }
  const emailNote = emailNotice(person.emailLine);
  return [
    `**${person.name}** is named **${person.designation}** on the official Industry Relations & Placements team page.`,
    person.phone ? `Phone printed on that page: ${person.phone}.` : '',
    emailNote,
    'The page does not print a date for when this role was last verified.',
    `[Placements team](${person.sourceUrl})`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function emailNotice(line: string): string {
  if (!line) return 'No email line is printed for this person.';
  const broken = /,/.test(line) || /\[email/i.test(line);
  const shown = line.replace(/\s+/g, ' ').trim();
  if (broken) {
    return `Email line printed on the page: ${shown}. That line is malformed or obfuscated on the official page, so it is quoted as published and not corrected.`;
  }
  return `Email line printed on the page: ${shown}.`;
}

function cleanup(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
