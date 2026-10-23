import type { AnswerBlock, Citation } from '@lbrce/shared';
import type { IntentType } from './intent.js';
import type { ScoredChunk } from './rank.js';
import { citationsFromChunks, excerptMarkdown, keepKnownCitations } from './citations.js';
import type { TimetableResolution } from '../timetable/resolve.js';

export interface FacultyRow {
  name: string;
  designation?: string;
  department?: string;
  email?: string;
  profileUrl?: string;
  isHead?: boolean;
  sourceUrl?: string;
  verificationStatus: 'verified' | 'unverified' | 'rejected' | 'unknown';
}

export type FacultyResolution =
  | { status: 'clarify'; question: string; options: string[] }
  | { status: 'detail'; person: FacultyRow }
  | { status: 'list'; people: FacultyRow[] };

export interface ImageHit {
  id: string;
  url: string;
  pageUrl?: string;
  title?: string;
  alt?: string;
  caption?: string;
  topic?: string;
}

export interface NarrativeDraft {
  markdown: string;
  citationIds: string[];
  relatedQuestions: string[];
  confidence: 'verified' | 'inferred' | 'insufficient';
}

export function assembleBlocks(input: {
  intent: IntentType;
  chunks: ScoredChunk[];
  images: ImageHit[];
  faculty?: FacultyRow[];
  facultyResolution?: FacultyResolution;
  resolution?: TimetableResolution;
  narrative?: NarrativeDraft | null;
  providerNote?: string;
  externalCitations?: Citation[];
  narrativeFromWeb?: boolean;
}): { blocks: AnswerBlock[]; relatedQuestions: string[] } {
  if (input.resolution?.status === 'clarify') {
    return {
      blocks: [
        {
          type: 'clarification',
          question: input.resolution.question,
          options: input.resolution.options,
        },
      ],
      relatedQuestions: [],
    };
  }

  if (input.facultyResolution?.status === 'clarify') {
    return {
      blocks: [
        {
          type: 'clarification',
          question: input.facultyResolution.question,
          options: input.facultyResolution.options,
        },
      ],
      relatedQuestions: [],
    };
  }

  const blocks: AnswerBlock[] = [];
  const citations = citationsFromChunks(input.chunks).map(officialCitation);

  if (input.resolution?.status === 'match') {
    const record = input.resolution.timetable;
    const selectedDay = input.resolution.day;
    const entries = selectedDay
      ? record.entries.filter((entry) => entry.dayOfWeek.toLowerCase() === selectedDay)
      : record.entries;
    const dayNote =
      selectedDay && record.entries.length > 0 && entries.length === 0
        ? `No stored periods match ${selectedDay}. That is not a guess that the class has no sessions.`
        : '';
    blocks.push({
      type: 'timetable',
      title: record.title,
      view: input.resolution.day ? 'day' : 'week',
      academicYear: record.academicYear,
      regulation: record.regulation,
      department: record.department,
      degree: record.degree,
      year: record.year,
      semester: record.semester,
      section: record.section,
      batch: record.batch,
      effectiveFrom: record.effectiveFrom,
      effectiveUntil: record.effectiveUntil,
      day: input.resolution.day,
      verificationStatus: input.resolution.verificationStatus,
      note: [input.resolution.note, input.resolution.conflictNote, dayNote].filter(Boolean).join(' '),
      entries,
      imageUrl: record.imageUrl,
      citations: [
        {
          id: record.id,
          title: record.title,
          url: collegeUrl(record.sourceUrl),
          effectiveFrom: record.effectiveFrom,
          effectiveUntil: record.effectiveUntil,
          verificationStatus: record.verificationStatus === 'verified' ? 'verified' : 'unverified',
          sourceType: 'timetable',
        },
      ],
    });
  }

  if (input.facultyResolution?.status === 'detail') {
    blocks.push(...facultyDetail(input.facultyResolution.person));
  } else if (input.intent === 'faculty' && input.faculty && input.faculty.length > 0) {
    blocks.push({
      type: 'table',
      title: 'Faculty records retrieved from indexed sources',
      columns: ['Name', 'Designation', 'Department', 'Verification'],
      rows: input.faculty.map((person) => [
        person.name,
        person.designation ?? '',
        person.department ?? '',
        person.verificationStatus,
      ]),
      sortable: true,
      citations: facultyCitations(input.faculty),
    });
  }

  if (input.images.length) {
    blocks.push({
      type: 'image_gallery',
      title: 'Images from official pages',
      images: input.images.map((image) => ({ ...image, pageUrl: collegeUrl(image.pageUrl) })),
      citations: input.images.map((image) => ({
        id: image.id,
        title: image.title || image.alt || 'Official image',
        url: collegeUrl(image.pageUrl) ?? collegeUrl(image.url),
        verificationStatus: 'unverified' as const,
        sourceType: 'image' as const,
      })),
    });
  }

  const narrative = groundedNarrative(input.narrative, citations, input.externalCitations, input.narrativeFromWeb);
  if (narrative) {
    blocks.unshift({
      type: 'text',
      markdown: input.providerNote ? `${narrative.markdown}\n\n_${input.providerNote}_` : narrative.markdown,
      citations: narrative.citations,
    });
  } else if (input.chunks.length && input.intent !== 'timetable') {
    blocks.push({
      type: 'text',
      markdown: excerptMarkdown(input.chunks),
      citations,
    });
  } else if (!blocks.length) {
    blocks.push({
      type: 'insufficient_evidence',
      message:
        'This could not be verified from the college sources currently indexed. I will not guess faculty names, schedules, fees, dates, rooms, results, or placement statistics.',
      suggestions: [
        'Ask an administrator to refresh the official website index or upload the relevant notice.',
        'Include the department, semester, section, and academic year if you are asking about a timetable.',
      ],
    });
  }

  return {
    blocks,
    relatedQuestions: narrative?.relatedQuestions ?? [],
  };
}

function groundedNarrative(
  narrative: NarrativeDraft | null | undefined,
  citations: Citation[],
  externalCitations?: Citation[],
  fromWeb?: boolean,
): { markdown: string; citations: Citation[]; relatedQuestions: string[] } | undefined {
  if (!narrative || narrative.confidence === 'insufficient' || !narrative.markdown.trim()) return undefined;
  const pool = fromWeb ? [...(externalCitations ?? []), ...citations] : citations;
  const kept = keepKnownCitations(narrative.citationIds, pool);
  if (!fromWeb && !kept.length) return undefined;
  const attached = (kept.length ? kept : (externalCitations ?? [])).filter((citation) => !citation.url || collegeUrl(citation.url));
  return {
    markdown: stripExternalLinks(narrative.markdown),
    citations: attached,
    relatedQuestions: narrative.relatedQuestions.filter((item) => item.trim().length > 0).slice(0, 3),
  };
}

function facultyDetail(person: FacultyRow): AnswerBlock[] {
  const profile = collegeUrl(person.profileUrl);
  const role = person.isHead ? 'Head of the department' : 'Faculty member';
  const rows = [
    ['Name', person.name],
    ['Designation', person.designation || 'Not listed on the official page'],
    ['Department', person.department || 'Not listed'],
    ['Role', role],
  ];
  if (person.email) rows.push(['Email', person.email]);
  const summary = [`**${person.name}** is listed as ${person.designation || 'faculty'} in ${person.department || 'the college'}.`, `Role: ${role}.`];
  if (profile) summary.push(`[Official profile](${profile})`);
  return [
    { type: 'text', markdown: summary.join('\n\n'), citations: [] },
    {
      type: 'table',
      title: 'Faculty record',
      columns: ['Field', 'Detail'],
      rows,
      sortable: false,
      citations: facultyCitations([person]),
    },
  ];
}

function facultyCitations(rows: FacultyRow[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const row of rows) {
    const url = collegeUrl(row.sourceUrl) ?? '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      id: url,
      title: `${row.department ?? 'Department'} faculty source`,
      url,
      verificationStatus: row.verificationStatus,
      sourceType: 'structured',
    });
  }
  return citations;
}

function collegeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'lbrce.ac.in' || host.endsWith('.lbrce.ac.in') ? url : undefined;
  } catch {
    return undefined;
  }
}

function officialCitation(citation: Citation): Citation {
  return { ...citation, url: collegeUrl(citation.url) };
}

function stripExternalLinks(markdown: string): string {
  const withoutMarkdown = markdown.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (full, label: string, url: string) =>
    collegeUrl(url) ? full : String(label),
  );
  return withoutMarkdown.replace(/https?:\/\/[^\s)]+/g, (raw) => {
    const trimmed = raw.replace(/[.,;:]+$/, '');
    const tail = raw.slice(trimmed.length);
    return collegeUrl(trimmed) ? raw : tail.trim() ? '' : '';
  });
}
