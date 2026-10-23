import type { AnswerBlock, ChatResponse, Citation } from '@lbrce/shared';
import { Conversation, Message } from '../models/index.js';
import { loadOfficialCalendar } from '../integrations/calendar-source.js';
import { lookupStudents, registrationNumbers } from '../integrations/student-lookup.js';
import { WEB_SYSTEM_PROMPT } from '../integrations/gemini/prompt.js';
import { getProvider } from '../integrations/gemini/provider.js';
import { assembleBlocks, type FacultyResolution } from '../retrieval/assemble.js';
import { planFacultyQuestion, readFacultyStep, shouldContinueFaculty } from '../retrieval/faculty-guide.js';
import { detectIntent, extractEntities } from '../retrieval/intent.js';
import type { ScoredChunk } from '../retrieval/rank.js';
import { generateNarrative, lookupNamedRecords, resolveFacultyRequest, searchKnowledge, streamNarrative } from '../retrieval/search.js';
import { resolveTimetableQuery } from '../timetable/resolve.js';
import { isoDateInKolkata } from '../utils/time.js';
import { ProviderError } from '../utils/http-error.js';
import { logger } from '../utils/logger.js';

export async function answerQuestion(input: {
  message: string;
  sessionId: string;
  conversationId?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  onToken?: (token: string) => void;
}): Promise<ChatResponse> {
  const conversation = await getConversation(input.sessionId, input.conversationId, input.message);
  await Message.create({ conversationId: conversation._id, role: 'user', content: input.message, status: 'complete' });
  input.onStatus?.('Searching indexed college sources');

  const intent = detectIntent(input.message);
  const entities = extractEntities(input.message);
  const priorAssistant = (await Message.findOne({ conversationId: conversation._id, role: 'assistant' }).sort({ createdAt: -1 }).lean()) as { blocks?: unknown } | null;
  const priorStep = readFacultyStep(priorAssistant?.blocks);
  const continuingFaculty = shouldContinueFaculty(input.message, priorStep);
  const facultyPlan = intent.type === 'faculty' || continuingFaculty ? planFacultyQuestion(input.message, entities, continuingFaculty ? priorStep : undefined) : undefined;
  let facultyResolution: FacultyResolution | undefined;
  if (facultyPlan) {
    input.onStatus?.(facultyPlan.action === 'ask-department' || facultyPlan.action === 'continue-department' ? 'Choosing a department' : 'Fetching faculty details');
    facultyResolution = await resolveFacultyRequest(facultyPlan, input.message);
  }
  const knowledge =
    facultyResolution
      ? {
          chunks: [] as ScoredChunk[],
          faculty: facultyResolution.status === 'list' ? facultyResolution.people : [],
          timetables: [],
          images: [],
        }
      : await searchKnowledge(input.message, intent.type, entities);
  let narrative = null;
  let providerNote: string | undefined;
  let webCitations: Citation[] = [];
  let fromWeb = false;
  const rollNumbers = registrationNumbers(input.message);
  const nameTokens = requiredNameTokens(input.message);
  if (rollNumbers.length) {
    input.onStatus?.('Checking the official student lists');
    const students = await lookupStudents(rollNumbers, input.signal);
    const found = new Set(students.map((student) => student.registrationNumber));
    const missing = rollNumbers.filter((number) => !found.has(number));
    const lines = students.map(
      (student) => `- **${student.registrationNumber}** — ${student.name} ([official list](${student.url}))`,
    );
    if (missing.length) {
      lines.push('', `These numbers are not on the published department student lists: ${missing.join(', ')}.`);
    }
    webCitations = students
      .filter((student, index) => students.findIndex((item) => item.url === student.url) === index)
      .map((student) => ({
        id: student.url,
        title: student.title,
        url: student.url,
        retrievedAt: new Date().toISOString(),
        verificationStatus: 'unverified' as const,
        sourceType: 'webpage' as const,
      }));
    fromWeb = webCitations.length > 0;
    narrative = {
      markdown: lines.join('\n'),
      citationIds: webCitations.map((citation) => citation.id),
      relatedQuestions: [],
      confidence: 'inferred' as const,
    };
    knowledge.chunks = [];
  } else if (nameTokens.length) knowledge.chunks = await lookupNamedRecords(nameTokens);
  const resolution =
    intent.type === 'timetable'
      ? resolveTimetableQuery({ ...entities, today: isoDateInKolkata() }, knowledge.timetables)
      : undefined;

  const answerIntent = facultyResolution ? 'faculty' : intent.type;
  const structured =
    resolution?.status === 'match' || resolution?.status === 'clarify' || Boolean(facultyResolution) || (intent.type === 'faculty' && knowledge.faculty.length > 0);
  const canNarrate =
    !facultyResolution &&
    knowledge.chunks.length > 0 &&
    resolution?.status !== 'clarify' &&
    (structured || chunksMatchQuestion(input.message, knowledge.chunks)) &&
    (intent.type !== 'calendar' || indexHasHoliday(input.message, knowledge.chunks));
  if (canNarrate && !input.signal?.aborted) {
    try {
      input.onStatus?.('Writing a grounded answer');
      if (input.onToken) {
        const streamed = await streamNarrative(input.message, knowledge.chunks, input.onToken, input.signal);
        if (input.signal?.aborted) throw new ProviderError('TIMEOUT', 'Generation was cancelled');
        if (streamed && !/could not be verified/i.test(streamed)) {
          narrative = {
            markdown: streamed,
            citationIds: knowledge.chunks.map((chunk) => chunk.id),
            relatedQuestions: [],
            confidence: 'inferred' as const,
          };
        }
      } else {
        narrative = await generateNarrative(input.message, knowledge.chunks, input.signal);
      }
    } catch (error) {
      if (input.signal?.aborted) throw error;
      providerNote = error instanceof ProviderError ? error.message : 'Answer generation is temporarily unavailable.';
      const detail = error instanceof Error ? error.message : providerNote;
      logger.warn({ err: detail.replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]') }, 'generation failed');
    }
  }

  const indexedAnswer = Boolean(narrative && narrative.confidence !== 'insufficient' && !/could not be verified/i.test(narrative.markdown));
  const rateLimited = /rate limit/i.test(providerNote ?? '');
  const calendarQuestion = intent.type === 'calendar';
  if (!indexedAnswer && !structured && !rateLimited && calendarQuestion && !input.signal?.aborted) {
    input.onStatus?.('Reading the official academic calendar');
    try {
      const calendar = await loadOfficialCalendar(input.message, input.signal);
      if (calendar) {
        const provider = getProvider();
        let text = '';
        if (calendar.pdf && provider.readDocument) {
          text = await provider.readDocument({
            system:
              'You are LBRCE AI. The attached file is an official academic calendar of Lakireddy Bali Reddy College of Engineering. Answer only from dates and words visible in that file. Quote Sankranti or other holiday dates exactly as printed. If a date is not visible, say it is not visible. Do not invent dates. Only link to pages on lbrce.ac.in. Never include or mention any other website.',
            user: `${input.message}\n\nOfficial file: ${calendar.url}`,
            mimeType: 'application/pdf',
            data: calendar.pdf,
            signal: input.signal,
            onToken: input.onToken,
          });
        } else if (calendar.text) {
          text = await streamNarrative(
            input.message,
            [
              {
                id: calendar.url,
                title: calendar.title,
                text: calendar.text,
                url: calendar.url,
                verificationStatus: 'unverified',
                lexicalScore: 1,
                semanticScore: 0,
                sourceType: 'document',
              },
            ],
            input.onToken ?? (() => undefined),
            input.signal,
          );
        }
        if (text && !/could not be verified/i.test(text)) {
          fromWeb = true;
          webCitations = [
            {
              id: calendar.url,
              title: calendar.title,
              url: calendar.url,
              retrievedAt: new Date().toISOString(),
              verificationStatus: 'unverified',
              sourceType: 'document',
            },
          ];
          narrative = {
            markdown: `${text}\n\n_Read from the official academic calendar file._`,
            citationIds: [calendar.url],
            relatedQuestions: [],
            confidence: 'inferred' as const,
          };
          knowledge.chunks = [];
          providerNote = undefined;
        }
      }
    } catch (error) {
      if (input.signal?.aborted) throw error;
      providerNote = error instanceof ProviderError ? error.message : 'The academic calendar could not be read.';
      logger.warn({ err: (error instanceof Error ? error.message : providerNote).replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]') }, 'calendar read failed');
    }
  }
  const calendarAnswered = Boolean(narrative && /official academic calendar file/i.test(narrative.markdown));
  if (!indexedAnswer && !calendarAnswered && !structured && !rateLimited && !/rate limit/i.test(providerNote ?? '') && !input.signal?.aborted) {
    input.onStatus?.('Not in the college index. Searching the web');
    try {
      const provider = getProvider();
      if (!provider.searchWeb) throw new ProviderError('NOT_CONFIGURED', 'Web search is not available');
      const web = await provider.searchWeb({
        system: WEB_SYSTEM_PROMPT,
        user: input.message,
        signal: input.signal,
        onToken: input.onToken,
      });
      webCitations = web.sources.map((source) => ({
        id: source.url,
        title: source.title,
        url: source.url,
        retrievedAt: new Date().toISOString(),
        verificationStatus: 'unverified' as const,
        sourceType: 'webpage' as const,
      }));
      fromWeb = true;
      narrative = {
        markdown: webCitations.length
          ? `${web.text}\n\n_Looked up on the public web because this was not in the indexed college pages._`
          : web.text,
        citationIds: webCitations.map((citation) => citation.id),
        relatedQuestions: [],
        confidence: 'inferred' as const,
      };
      knowledge.chunks = [];
      providerNote = undefined;
    } catch (error) {
      if (input.signal?.aborted) throw error;
      providerNote =
        error instanceof ProviderError && error.code === 'BAD_RESPONSE'
          ? 'Gemini could not finish a web search for that question. Wait a moment and ask again.'
          : error instanceof ProviderError
            ? error.message
            : 'Web search is temporarily unavailable.';
      const detail = error instanceof Error ? error.message : providerNote;
      logger.warn({ err: detail.replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]') }, 'web search failed');
      if (error instanceof ProviderError && error.code === 'RATE_LIMIT') knowledge.chunks = [];
    }
  }

  const assembled = assembleBlocks({
    intent: answerIntent,
    chunks: knowledge.chunks,
    images: intent.wantsImages || intent.type === 'image' || intent.type === 'timetable' ? knowledge.images : [],
    faculty: knowledge.faculty,
    facultyResolution,
    resolution,
    narrative,
    providerNote,
    externalCitations: webCitations,
    narrativeFromWeb: fromWeb,
  });
  if (providerNote && assembled.blocks.every((block) => block.type !== 'text')) {
    assembled.blocks = [
      { type: 'text', markdown: providerNote, citations: [] },
      ...assembled.blocks.filter((block) => block.type !== 'insufficient_evidence'),
    ];
  }
  const assistant = await Message.create({
    conversationId: conversation._id,
    role: 'assistant',
    content: plainText(assembled.blocks),
    blocks: assembled.blocks,
    relatedQuestions: assembled.relatedQuestions,
    status: 'complete',
  });
  return {
    conversationId: String(conversation._id),
    messageId: String(assistant._id),
    blocks: assembled.blocks,
    relatedQuestions: assembled.relatedQuestions,
  };
}

async function getConversation(sessionId: string, conversationId: string | undefined, message: string) {
  if (conversationId) {
    const existing = await Conversation.findOne({ _id: conversationId, sessionId });
    if (existing) return existing;
  }
  return Conversation.create({ sessionId, title: message.slice(0, 80) });
}

function indexHasHoliday(message: string, chunks: ScoredChunk[]): boolean {
  if (!/sankranthi|sankranti|pongal/i.test(message)) return chunks.length > 0;
  return chunks.some((chunk) => /sankranthi|sankranti|pongal/i.test(chunk.text));
}

function chunksMatchQuestion(message: string, chunks: ScoredChunk[]): boolean {
  const stop = new Set(['what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how', 'does', 'did', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'about', 'lbrce', 'college', 'please', 'show', 'tell', 'can', 'you', 'fetch', 'name']);
  const tokens = [...message.toLowerCase().matchAll(/\b[a-z0-9]{4,}\b/g)].map((match) => match[0]).filter((token) => !stop.has(token));
  if (!tokens.length) return chunks.length > 0;
  return chunks.some((chunk) => {
    const text = `${chunk.title} ${chunk.text}`.toLowerCase();
    const hits = tokens.filter((token) => text.includes(token));
    return hits.length >= Math.min(2, tokens.length);
  });
}

function requiredNameTokens(message: string): string[] {
  if (!/\b(student\s*id|admission\s*(number|no\.?)|regd\.?|registration\s*(number|no\.?)|roll\s*(number|no\.?)|hall\s*ticket|named)\b/i.test(message)) return [];
  const stop = new Set(
    'student fetch with name from list can you the and for tell admission number person named lbrce college department computer science engineering please what when where which about their there roll registration hall ticket details find give show need want this that your have has been were was are not into'.split(' '),
  );
  return [...new Set([...message.matchAll(/\b[A-Za-z]{4,}\b/g)].map((match) => match[0].toUpperCase()).filter((token) => !stop.has(token.toLowerCase())))];
}

function plainText(blocks: AnswerBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'text' || block.type === 'document_summary') return block.markdown;
      if (block.type === 'insufficient_evidence') return block.message;
      if (block.type === 'clarification') return block.question;
      if (block.type === 'timetable') return block.title;
      if (block.type === 'table') return block.title ?? 'Table';
      if (block.type === 'image_gallery') return block.title ?? 'Images';
      if (block.type === 'source_list') return block.title ?? 'Sources';
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 4000);
}

export async function listConversations(sessionId: string): Promise<any[]> {
  return Conversation.find({ sessionId }).sort({ updatedAt: -1 }).limit(30).lean();
}

export async function getConversationMessages(id: string, sessionId: string): Promise<{ conversation: any; messages: any[] } | null> {
  const conversation = await Conversation.findOne({ _id: id, sessionId }).lean();
  if (!conversation) return null;
  const messages = (await Message.find({ conversationId: id }).sort({ createdAt: 1 }).limit(200).lean()) as any[];
  return { conversation, messages };
}

export async function deleteConversation(id: string, sessionId: string) {
  const conversation = await Conversation.findOneAndDelete({ _id: id, sessionId });
  if (!conversation) return false;
  await Message.deleteMany({ conversationId: id });
  return true;
}
