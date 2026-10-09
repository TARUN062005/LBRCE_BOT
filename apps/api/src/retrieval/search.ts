import { generatedNarrativeSchema } from '@lbrce/shared';
import { getEnv } from '../config/env.js';
import { getProvider } from '../integrations/gemini/provider.js';
import { buildEvidencePrompt, NARRATIVE_JSON_SCHEMA, STREAM_SYSTEM_PROMPT, SYSTEM_PROMPT } from '../integrations/gemini/prompt.js';
import { CollegeImage, DocumentChunk, Faculty, Timetable, TimetableEntry } from '../models/index.js';
import type { FacultyRow, ImageHit, NarrativeDraft } from './assemble.js';
import { documentTypeForIntent, type IntentType, type QueryEntities } from './intent.js';
import { cosineSimilarity, mergeChunkHits, rankChunks, type ScoredChunk } from './rank.js';
import type { StoredTimetable } from '../timetable/resolve.js';
import { logger } from '../utils/logger.js';
import { ProviderError } from '../utils/http-error.js';

export async function searchKnowledge(query: string, intent: IntentType, entities: QueryEntities) {
  const department = entities.department;
  const documentType = documentTypeForIntent(intent);
  const [lexical, semantic, faculty, timetables, images] = await Promise.all([
    lexicalSearch(query, department, documentType),
    semanticSearch(query, department, documentType),
    intent === 'faculty' ? facultySearch(query, department) : Promise.resolve([]),
    intent === 'timetable' ? timetableSearch(entities) : Promise.resolve([]),
    imageSearch(query, intent),
  ]);
  return {
    chunks: rankChunks(mergeChunkHits([lexical, semantic])),
    faculty,
    timetables,
    images,
  };
}

export async function generateNarrative(
  question: string,
  chunks: ScoredChunk[],
  signal?: AbortSignal,
): Promise<NarrativeDraft | null> {
  const usable = chunks.filter((chunk) => chunk.verificationStatus !== 'rejected').slice(0, 6);
  if (!usable.length) return null;
  const provider = getProvider();
  if (!provider.isConfigured()) return null;
  if (usable.every((chunk) => chunkAllowsAi(chunk) === false)) return null;
  const raw = await provider.generate({
    system: SYSTEM_PROMPT,
    user: buildEvidencePrompt(question, usable.filter((chunk) => chunkAllowsAi(chunk) !== false)),
    schema: NARRATIVE_JSON_SCHEMA,
    signal,
  });
  const parsed = generatedNarrativeSchema.safeParse(parseJson(raw));
  if (!parsed.success) throw new ProviderError('BAD_RESPONSE', 'The model returned malformed JSON');
  return parsed.data;
}

export async function streamNarrative(
  question: string,
  chunks: ScoredChunk[],
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const usable = chunks.filter((chunk) => chunkAllowsAi(chunk) !== false).slice(0, 6);
  const provider = getProvider();
  if (!provider.isConfigured() || !usable.length) return '';
  let text = '';
  for await (const token of provider.stream({
    system: STREAM_SYSTEM_PROMPT,
    user: buildEvidencePrompt(question, usable),
    signal,
  })) {
    text += token;
    onToken(token);
  }
  return text;
}

async function lexicalSearch(query: string, department?: string, documentType?: string): Promise<ScoredChunk[]> {
  const filter: Record<string, unknown> = { published: true, $text: { $search: query } };
  if (department) filter['metadata.department'] = department;
  if (documentType) filter['metadata.documentType'] = documentType;
  try {
    const rows = await DocumentChunk.find(filter, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(40)
      .lean();
    return rows.map((row) => toChunk(row, Number(row.score ?? 0), 0));
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : 'text search failed' }, 'lexical search fallback');
    const loose: Record<string, unknown> = {
      published: true,
      text: new RegExp(escapeRegex(query).slice(0, 80), 'i'),
    };
    if (department) loose['metadata.department'] = department;
    const rows = await DocumentChunk.find(loose).limit(40).lean();
    return rows.map((row) => toChunk(row, 1, 0));
  }
}

async function semanticSearch(query: string, department?: string, documentType?: string): Promise<ScoredChunk[]> {
  const provider = getProvider();
  if (!provider.isConfigured()) return [];
  let vector: number[] = [];
  try {
    vector = (await provider.embed([query], 'RETRIEVAL_QUERY'))[0] ?? [];
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : 'embed failed' }, 'semantic search skipped');
    return [];
  }
  if (!vector.length) return [];
  const index = getEnv().VECTOR_SEARCH_INDEX;
  if (index) {
    try {
      const rows = await DocumentChunk.aggregate([
        {
          $vectorSearch: {
            index,
            path: 'embedding',
            queryVector: vector,
            numCandidates: 80,
            limit: 12,
            filter: { published: true },
          },
        },
      ]);
      const hits = rows
        .filter((row) => matchesMeta(row, department, documentType))
        .map((row) => toChunk(row, 0, Number(row.score ?? 0.5)));
      if (hits.length) return hits;
      logger.warn('vector search returned no rows, using cosine fallback');
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : 'vector search failed' }, 'using cosine fallback');
    }
  }
  const filter: Record<string, unknown> = { published: true, embeddingModel: { $exists: true } };
  if (department) filter['metadata.department'] = department;
  if (documentType) filter['metadata.documentType'] = documentType;
  const rows = await DocumentChunk.find(filter)
    .select('+embedding title text sourceUrl pageNumber section heading verificationStatus metadata retrievedAt allowAiInput')
    .limit(250)
    .lean();
  return rows
    .map((row) => toChunk(row, 0, cosineSimilarity(vector, row.embedding ?? [])))
    .filter((chunk) => chunk.semanticScore >= 0.35);
}

async function facultySearch(query: string, department?: string): Promise<FacultyRow[]> {
  const filter: Record<string, unknown> = { verificationStatus: { $ne: 'rejected' } };
  if (department) filter.department = department;
  if (/\b(head|hod)\b/i.test(query)) filter.isHead = true;
  const rows = await Faculty.find(filter).limit(100).lean();
  return rows.map((row) => ({
    name: row.name,
    designation: row.designation ?? undefined,
    department: row.department ?? undefined,
    sourceUrl: row.sourceUrl,
    verificationStatus: row.verificationStatus,
  }));
}

async function timetableSearch(entities: QueryEntities): Promise<StoredTimetable[]> {
  const filter: Record<string, unknown> = { verificationStatus: { $ne: 'rejected' } };
  if (entities.department) filter.department = entities.department;
  if (entities.year) filter.year = entities.year;
  if (entities.semester) filter.semester = entities.semester;
  if (entities.section) filter.section = entities.section.toUpperCase();
  if (entities.academicYear) filter.academicYear = entities.academicYear;
  const tables = await Timetable.find(filter).sort({ updatedAt: -1 }).limit(50).lean();
  const entries = await TimetableEntry.find({ timetableId: { $in: tables.map((table) => table._id) } }).lean();
  return tables.map((table) => ({
    id: String(table._id),
    title: table.title,
    department: table.department ?? undefined,
    academicYear: table.academicYear ?? undefined,
    year: table.year ?? undefined,
    semester: table.semester ?? undefined,
    section: table.section ?? undefined,
    regulation: table.regulation ?? undefined,
    degree: table.degree ?? undefined,
    batch: table.batch ?? undefined,
    effectiveFrom: table.effectiveFrom ? new Date(table.effectiveFrom).toISOString() : undefined,
    effectiveUntil: table.effectiveUntil ? new Date(table.effectiveUntil).toISOString() : undefined,
    verificationStatus: table.verificationStatus,
    sourceUrl: table.sourceUrl ?? undefined,
    imageUrl: table.imageUrl ?? undefined,
    updatedAt: table.updatedAt ? new Date(table.updatedAt).toISOString() : undefined,
    entries: entries
      .filter((entry) => String(entry.timetableId) === String(table._id))
      .map((entry) => ({
        dayOfWeek: entry.dayOfWeek,
        periodNumber: entry.periodNumber ?? undefined,
        startTime: entry.startTime ?? undefined,
        endTime: entry.endTime ?? undefined,
        subjectCode: entry.subjectCode ?? undefined,
        subjectName: entry.subjectName ?? undefined,
        faculty: entry.faculty ?? undefined,
        room: entry.room ?? undefined,
        entryType: entry.entryType ?? 'other',
        confidence: entry.confidence ?? 0,
      })),
  }));
}

async function imageSearch(query: string, intent: IntentType): Promise<ImageHit[]> {
  if (intent !== 'image' && intent !== 'timetable' && !/\b(photo|image|picture|gallery)\b/i.test(query)) return [];
  let rows: any[] = [];
  try {
    rows = await CollegeImage.find({ $text: { $search: query } }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(12)
      .lean();
  } catch {
    rows = await CollegeImage.find().sort({ updatedAt: -1 }).limit(80).lean();
  }
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !['the', 'show', 'official', 'photographs', 'photos', 'image', 'images'].includes(token));
  return rows
    .map((row) => {
      const haystack = `${row.title ?? ''} ${row.alt ?? ''} ${row.caption ?? ''} ${row.context ?? ''} ${row.topic ?? ''}`.toLowerCase();
      const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      return { row, score };
    })
    .filter((item) => item.score > 0 || intent === 'timetable')
    .slice(0, 8)
    .map(({ row }) => ({
      id: String(row._id),
      url: row.sourceUrl,
      pageUrl: row.pageUrl,
      title: row.title,
      alt: row.alt,
      caption: row.caption,
      topic: row.topic,
    }));
}

function toChunk(row: Record<string, any>, lexicalScore: number, semanticScore: number): ScoredChunk {
  return {
    id: String(row._id),
    title: row.title || 'Untitled source',
    text: row.text || '',
    url: row.sourceUrl,
    pageNumber: row.pageNumber,
    section: row.section || row.heading,
    verificationStatus: row.verificationStatus ?? 'unknown',
    publishedAt: row.metadata?.publishedAt ? new Date(row.metadata.publishedAt).toISOString() : undefined,
    retrievedAt: row.retrievedAt ? new Date(row.retrievedAt).toISOString() : undefined,
    documentType: row.metadata?.documentType,
    lexicalScore,
    semanticScore,
    sourceType: row.documentId ? 'document' : 'webpage',
    allowAiInput: row.allowAiInput !== false,
  };
}

function matchesMeta(row: { metadata?: { department?: string; documentType?: string } }, department?: string, documentType?: string) {
  if (department && row.metadata?.department && row.metadata.department !== department) return false;
  if (documentType && row.metadata?.documentType && row.metadata.documentType !== documentType) return false;
  return true;
}

function chunkAllowsAi(chunk: ScoredChunk & { allowAiInput?: boolean }): boolean {
  return chunk.allowAiInput !== false;
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
  return JSON.parse(trimmed);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
