import { describe, expect, it } from 'vitest';
import { extractEntities } from './intent.js';
import { citationsFromChunks, excerptMarkdown, keepKnownCitations } from './citations.js';
import { cosineSimilarity, mergeChunkHits, rankChunks, type ScoredChunk } from './rank.js';
import { parseContentSignals } from '../integrations/college-sources/signals.js';
import { assembleBlocks } from './assemble.js';

const chunk = (overrides: Partial<ScoredChunk>): ScoredChunk => ({
  id: 'c1',
  title: 'Synthetic page',
  text: 'SYNTHETIC FIXTURE. This sentence is not an official college fact.',
  url: 'https://www.lbrce.ac.in/example',
  verificationStatus: 'unverified',
  lexicalScore: 1,
  semanticScore: 0.2,
  sourceType: 'webpage',
  ...overrides,
});

describe('query understanding', () => {
  it('maps second year first semester to semester 3 and section A', () => {
    const entities = extractEntities('Show the timetable for CSE, second year, first semester, section A.', new Date('2026-10-09T04:00:00Z'));
    expect(entities.department).toBe('CSE');
    expect(entities.year).toBe(2);
    expect(entities.semester).toBe(3);
    expect(entities.section).toBe('A');
  });

  it('uses the Asia/Kolkata weekday for today', () => {
    const entities = extractEntities("What is today's timetable for CSE section A?", new Date('2026-10-09T04:00:00Z'));
    expect(entities.day).toBe('friday');
  });
});

describe('ranking and citations', () => {
  it('ranks a descriptive page above a footer with the same retrieval scores', () => {
    const ranked = rankChunks([
      chunk({
        id: 'footer',
        text: 'Call us: 08659. All Rights Reserved. Designed & Developed by LBRCE Web Team',
      }),
      chunk({
        id: 'about',
        text: 'Lakireddy Bali Reddy College of Engineering is an autonomous college in Mylavaram. Its mission is to provide an environment conducive to learning and academic excellence for students and faculty across undergraduate programmes.',
      }),
    ]);
    expect(ranked[0]?.id).toBe('about');
  });

  it('ranks a verified semantic match ahead of a weak lexical hit', () => {
    const ranked = rankChunks([
      chunk({ id: 'weak', lexicalScore: 5, semanticScore: 0.1, verificationStatus: 'unverified' }),
      chunk({ id: 'strong', lexicalScore: 1, semanticScore: 0.92, verificationStatus: 'verified' }),
    ]);
    expect(ranked[0]?.id).toBe('strong');
  });

  it('merges lexical and semantic hits for the same chunk', () => {
    const merged = mergeChunkHits([
      [chunk({ lexicalScore: 3, semanticScore: 0 })],
      [chunk({ lexicalScore: 0, semanticScore: 0.8 })],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.semanticScore).toBe(0.8);
    expect(merged[0]?.lexicalScore).toBe(3);
  });

  it('drops citations the model was not given', () => {
    const citations = citationsFromChunks([chunk({ id: 'real' })]);
    expect(keepKnownCitations(['real', 'invented'], citations).map((item) => item.id)).toEqual(['real']);
  });

  it('computes cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe('grounded answers', () => {
  it('refuses to answer when nothing was retrieved', () => {
    const answer = assembleBlocks({ intent: 'general', chunks: [], images: [] });
    expect(answer.blocks[0]?.type).toBe('insufficient_evidence');
  });

  it('quotes retrieved text when the model returns no usable citations', () => {
    const answer = assembleBlocks({
      intent: 'general',
      chunks: [chunk({})],
      images: [],
      narrative: {
        markdown: 'The fee is 999999 rupees.',
        citationIds: ['does-not-exist'],
        relatedQuestions: [],
        confidence: 'verified',
      },
    });
    const text = answer.blocks.find((block) => block.type === 'text');
    expect(text && text.type === 'text' ? text.markdown : '').not.toMatch(/999999/);
    expect(text && text.type === 'text' ? text.markdown : '').toMatch(/Retrieved excerpts/);
  });

  it('keeps a cited narrative and ignores an uncited claim path', () => {
    const answer = assembleBlocks({
      intent: 'general',
      chunks: [chunk({ id: 'real', text: 'The official page describes the college as autonomous.' })],
      images: [],
      narrative: {
        markdown: 'The retrieved page describes the college as autonomous.',
        citationIds: ['real'],
        relatedQuestions: ['Where is the campus?'],
        confidence: 'verified',
      },
    });
    const text = answer.blocks.find((block) => block.type === 'text');
    expect(text && text.type === 'text' ? text.citations.map((item) => item.id) : []).toEqual(['real']);
  });

  it('renders timetable rows only from stored entries', () => {
    const answer = assembleBlocks({
      intent: 'timetable',
      chunks: [],
      images: [],
      resolution: {
        status: 'match',
        verificationStatus: 'verified',
        timetable: {
          id: 'tt',
          title: 'Synthetic CSE timetable',
          department: 'CSE',
          year: 2,
          semester: 3,
          section: 'A',
          academicYear: '2026-27',
          verificationStatus: 'verified',
          sourceUrl: 'https://www.lbrce.ac.in/cse/csetimetables.php',
          entries: [
            {
              dayOfWeek: 'friday',
              periodNumber: 1,
              startTime: '09:00',
              endTime: '09:50',
              subjectName: 'Synthetic Subject',
              faculty: 'Example Faculty',
              room: 'C-101',
              entryType: 'lecture',
              confidence: 1,
            },
          ],
        },
      },
    });
    const block = answer.blocks[0];
    expect(block?.type).toBe('timetable');
    if (block?.type === 'timetable') {
      expect(block.entries[0]?.subjectName).toBe('Synthetic Subject');
      expect(block.citations[0]?.url).toContain('lbrce.ac.in');
    }
  });
});

describe('content signals', () => {
  it('reads an ai-input denial', () => {
    expect(parseContentSignals('User-agent: *\nContent-Signal: search=yes, ai-input=no, ai-train=no\n')).toEqual({
      search: true,
      aiInput: false,
      aiTrain: false,
    });
  });
});

describe('excerpts', () => {
  it('does not present excerpts as a generated summary', () => {
    expect(excerptMarkdown([chunk({})])).toMatch(/not produced/);
  });
});
