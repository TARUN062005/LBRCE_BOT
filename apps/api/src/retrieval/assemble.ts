import type { AnswerBlock, Citation } from '@lbrce/shared';
import type { IntentType } from './intent.js';
import type { ScoredChunk } from './rank.js';
import { citationsFromChunks, excerptMarkdown, keepKnownCitations } from './citations.js';
import type { TimetableResolution } from '../timetable/resolve.js';

export interface FacultyRow {
  name: string;
  designation?: string;
  department?: string;
  sourceUrl?: string;
  verificationStatus: 'verified' | 'unverified' | 'rejected' | 'unknown';
}

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
  resolution?: TimetableResolution;
  narrative?: NarrativeDraft | null;
  providerNote?: string;
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

  const blocks: AnswerBlock[] = [];
  const citations = citationsFromChunks(input.chunks);

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
          url: record.sourceUrl,
          effectiveFrom: record.effectiveFrom,
          effectiveUntil: record.effectiveUntil,
          verificationStatus: record.verificationStatus === 'verified' ? 'verified' : 'unverified',
          sourceType: 'timetable',
        },
      ],
    });
  }

  if (input.intent === 'faculty' && input.faculty && input.faculty.length > 0) {
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
      images: input.images,
      citations: input.images.map((image) => ({
        id: image.id,
        title: image.title || image.alt || 'Official image',
        url: image.pageUrl || image.url,
        verificationStatus: 'unverified' as const,
        sourceType: 'image' as const,
      })),
    });
  }

  const narrative = groundedNarrative(input.narrative, citations);
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
): { markdown: string; citations: Citation[]; relatedQuestions: string[] } | undefined {
  if (!narrative || narrative.confidence === 'insufficient') return undefined;
  const kept = keepKnownCitations(narrative.citationIds, citations);
  if (!kept.length) return undefined;
  return {
    markdown: narrative.markdown,
    citations: kept,
    relatedQuestions: narrative.relatedQuestions.filter((item) => item.trim().length > 0).slice(0, 3),
  };
}

function facultyCitations(rows: FacultyRow[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const row of rows) {
    const url = row.sourceUrl ?? '';
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
