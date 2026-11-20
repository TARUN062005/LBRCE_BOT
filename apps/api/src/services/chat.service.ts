import type { AnswerBlock, ChatResponse, Citation } from '@lbrce/shared';
import { Conversation, Message, AgentRun } from '../models/index.js';
import { runCollegeAgent } from '../agent/orchestrator.js';
import { askPythonAgent } from '../integrations/python-agent.js';
import { calendarYearOptions, loadOfficialCalendar } from '../integrations/calendar-source.js';
import { loadOfficialTopicPages, officialTargetsFor } from '../integrations/official-pages.js';
import { lookupStudents, registrationNumbers } from '../integrations/student-lookup.js';
import { WEB_SYSTEM_PROMPT } from '../integrations/gemini/prompt.js';
import { getProvider } from '../integrations/gemini/provider.js';
import { assembleBlocks, type FacultyResolution, type NarrativeDraft } from '../retrieval/assemble.js';
import { chunksAnswerQuestion, evidenceHasToday, figuresSupported, pageAnswersQuestion, unverifiedMessage } from '../retrieval/grounding.js';
import { planFacultyQuestion, readFacultyStep, shouldContinueFaculty } from '../retrieval/faculty-guide.js';
import { carryEntities, dependsOnEarlierTurn, isComparative } from '../retrieval/conversation.js';
import { asksForInstitutionalRole, asksForStudentRoster, detectIntent, extractEntities, indexAnswersCalendar, topicPattern } from '../retrieval/intent.js';
import { officialGalleryPhotos } from '../retrieval/gallery.js';
import { imageTopic, isDecorativeImageUrl } from '../retrieval/images.js';
import { compareDepartmentPages } from '../retrieval/compare.js';
import { peopleFromPlacementContact, placementAnswerMarkdown, placementAsk } from '../retrieval/placements.js';
import { linesForRegulation } from '../retrieval/calendar-text.js';
import { evidenceSupportsRequestedRole, isInstitutionalDesignation, peopleFromFacultyHtml, requestedRoleFamily, roleAnswerMarkdown, roleGapMarkdown } from '../retrieval/roles.js';
import { fetchPublic } from '../integrations/college-sources/fetch.js';
import type { ScoredChunk } from '../retrieval/rank.js';
import { findRoleHolders, generateNarrative, lookupNamedRecords, resolveFacultyRequest, searchKnowledge, streamNarrative } from '../retrieval/search.js';
import { resolveTimetableQuery, type TimetableResolution } from '../timetable/resolve.js';
import { readValidatedTimetable } from '../timetable/read-grid.js';
import { isoDateInKolkata } from '../utils/time.js';
import { ProviderError } from '../utils/http-error.js';
import { logger } from '../utils/logger.js';

const studentLookups = new Map<string, number[]>();

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
  const followUp = dependsOnEarlierTurn(input.message);
  let entities = extractEntities(input.message);
  if (followUp) {
    const earlier = (await Message.find({ conversationId: conversation._id, role: 'user' }).sort({ createdAt: -1 }).skip(1).limit(3).lean()) as { content?: string }[];
    for (const row of earlier) entities = carryEntities(entities, extractEntities(String(row.content ?? '')));
  }
  const rosterRefusal = !registrationNumbers(input.message).length && asksForStudentRoster(input.message);
  const alsoWantsTimetable = /\b(timetable|time table)\b/i.test(input.message);
  if (rosterRefusal && !alsoWantsTimetable) {
    return persistAnswer(conversation._id, [
      {
        type: 'text',
        markdown:
          'I cannot provide a complete class roster, including names and registration numbers, through this public chat. I can still answer a timetable, section, or a count when an official college page states that count.',
        citations: [],
      },
    ]);
  }
  const calendarMessage = await calendarContinuation(conversation._id, input.message);
  if (process.env.NODE_ENV !== 'test' && wantsCalendarPicture(calendarMessage)) {
    if (!/\b20\d{2}\b/.test(calendarMessage)) {
      try {
        const years = await calendarYearOptions(input.signal);
        if (years.length > 1) {
          return persistAnswer(conversation._id, [
            {
              type: 'clarification',
              question: 'Which academic year should I open?',
              options: years.slice(0, 8).map((year) => `Academic calendar ${year}`),
            },
          ]);
        }
      } catch (error) {
        logger.warn({ err: error instanceof Error ? error.message : 'calendar listing failed' }, 'calendar listing failed');
      }
    } else {
      try {
        const calendar = await loadOfficialCalendar(calendarMessage, input.signal);
        if (calendar?.url) {
          const year = calendarMessage.match(/20\d{2}(?:\s*[-–]\s*\d{2,4})?/)?.[0] ?? '';
          const regulations = [...new Set([...calendar.text.matchAll(/\bR\d{2}\b/g)].map((match) => match[0] ?? ''))].filter(Boolean);
          const chosen = calendarMessage.match(/\bR\d{2}\b/i)?.[0]?.toUpperCase();
          if (regulations.length > 1 && !chosen) {
            return persistAnswer(conversation._id, [
              {
                type: 'clarification',
                question: `The ${year || 'selected'} calendar file prints more than one regulation. Which one should I read?`,
                options: regulations.map((regulation) => `Regulation ${regulation}`),
              },
            ]);
          }
          return persistAnswer(conversation._id, [
            {
              type: 'document_summary',
              title: year ? `Academic calendar ${year}` : calendar.title,
              markdown: calendarReadout(calendar.title, calendar.text, calendar.url, chosen),
              documentUrl: calendar.url,
              citations: [
                {
                  id: calendar.url,
                  title: calendar.title,
                  url: calendar.url,
                  retrievedAt: new Date().toISOString(),
                  verificationStatus: 'unverified',
                  sourceType: 'document',
                },
              ],
            },
          ]);
        }
      } catch (error) {
        logger.warn({ err: error instanceof Error ? error.message : 'calendar file failed' }, 'calendar file failed');
      }
    }
  }
  if (process.env.NODE_ENV !== 'test' && placementAsk(input.message)) {
    try {
      const page = await fetchPublic('https://www.lbrce.ac.in/placements/placementcontact.php', ['lbrce.ac.in']);
      const people = peopleFromPlacementContact(page.body.toString('utf8'), page.url || 'https://www.lbrce.ac.in/placements/placementcontact.php');
      const ask = placementAsk(input.message);
      if (ask && people.length) {
        return persistAnswer(conversation._id, [
          {
            type: 'text',
            markdown: placementAnswerMarkdown(ask, people),
            citations: [
              {
                id: page.url || 'https://www.lbrce.ac.in/placements/placementcontact.php',
                title: 'Placements team',
                url: page.url || 'https://www.lbrce.ac.in/placements/placementcontact.php',
                retrievedAt: new Date().toISOString(),
                verificationStatus: 'unverified',
                sourceType: 'webpage',
              },
            ],
          },
        ]);
      }
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : 'placement contact failed' }, 'placement contact failed');
    }
  }
  if (process.env.NODE_ENV !== 'test' && isComparative(input.message)) {
    try {
      const compared = await compareDepartmentPages(input.message);
      if (compared) {
        return persistAnswer(conversation._id, [{ type: 'text', markdown: compared.markdown, citations: [] }]);
      }
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : 'comparison failed' }, 'comparison failed');
    }
  }
  if (process.env.NODE_ENV !== 'test' && (intent.type === 'image' || intent.wantsImages) && /\b(photos?|photographs?|pictures?|gallery|galleries|campus)\b/i.test(input.message)) {
    try {
      const official = await officialGalleryPhotos(input.signal).catch(() => []);
      const images = official.map((photo) => ({ ...photo, topic: 'gallery' })).slice(0, 8);
      if (images.length) {
        return persistAnswer(conversation._id, [
          {
            type: 'text',
            markdown: 'Official gallery photographs. Homepage banners and non-official images are not included.',
            citations: [
              {
                id: 'https://www.lbrce.ac.in/gallery_pages/galleryindex.php',
                title: 'Official gallery',
                url: 'https://www.lbrce.ac.in/gallery_pages/galleryindex.php',
                retrievedAt: new Date().toISOString(),
                verificationStatus: 'unverified',
                sourceType: 'image',
              },
            ],
          },
          { type: 'image_gallery', images, citations: [] },
        ]);
      }
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : 'gallery failed' }, 'gallery failed');
    }
  }
  const priorAssistant = (await Message.findOne({ conversationId: conversation._id, role: 'assistant' }).sort({ createdAt: -1 }).lean()) as { blocks?: unknown } | null;
  const priorStep = readFacultyStep(priorAssistant?.blocks);
  const continuingFaculty = shouldContinueFaculty(input.message, priorStep);
  const comparative = isComparative(input.message);
  const roleQuestion = asksForInstitutionalRole(input.message);
  const facultyPlan =
    !followUp && !comparative && !roleQuestion && (intent.type === 'faculty' || continuingFaculty)
      ? planFacultyQuestion(input.message, entities, continuingFaculty ? priorStep : undefined)
      : undefined;
  let facultyResolution: FacultyResolution | undefined;
  let roleGap: string | undefined;
  if (roleQuestion) {
    const indexed = await findRoleHolders(input.message);
    let official: Awaited<ReturnType<typeof findRoleHolders>> | undefined;
    let pageUnreadable = false;
    if (process.env.NODE_ENV !== 'test') {
      try {
        const response = await fetchPublic('https://www.lbrce.ac.in/quicklinks_pages/faculty.php', ['lbrce.ac.in']);
        official = peopleFromFacultyHtml(response.body.toString('utf8'), response.url || 'https://www.lbrce.ac.in/quicklinks_pages/faculty.php');
      } catch (error) {
        pageUnreadable = true;
        logger.warn({ err: error instanceof Error ? error.message : 'faculty page failed' }, 'faculty role page failed');
      }
    }
    const family = requestedRoleFamily(input.message);
    const pool = official ?? indexed;
    const holders = pool.filter((person) =>
      family ? evidenceSupportsRequestedRole(input.message, person.designation ?? '') : isInstitutionalDesignation(person.designation ?? ''),
    );
    const related = (official ?? []).filter(
      (person) => isInstitutionalDesignation(person.designation ?? '') && !holders.some((holder) => holder.name === person.name && holder.designation === person.designation),
    );
    if (holders.length === 1) {
      facultyResolution = { status: 'detail', person: holders[0]!, note: roleAnswerMarkdown(holders[0]!) };
    } else if (holders.length > 1) {
      facultyResolution = {
        status: 'list',
        people: holders,
        note: 'More than one official record matches this designation. They are listed separately and are not collapsed into one current holder.',
      };
    } else if (pageUnreadable && indexed.length === 1) {
      facultyResolution = {
        status: 'detail',
        person: indexed[0]!,
        note: 'The official faculty page could not be read just now. The indexed designation is shown, and it is not confirmed as the current holder.',
      };
    } else if (pageUnreadable && indexed.length > 1) {
      facultyResolution = {
        status: 'list',
        people: indexed,
        note: 'The official faculty page could not be read just now. These indexed designations are not confirmed as the current holder.',
      };
    } else {
      roleGap = pageUnreadable
        ? 'The official faculty page could not be read, so the current holder of this training and placement role is not confirmed. A department head is not used in its place.'
        : roleGapMarkdown(input.message, related);
      if (!pageUnreadable && process.env.NODE_ENV !== 'test' && (family === 'head' || family === 'dean')) {
        try {
          const placement = await fetchPublic('https://www.lbrce.ac.in/placements/index.php', ['lbrce.ac.in']);
          const placementText = placement.body.toString('utf8').replace(/<[^>]+>/g, ' ');
          if (/training\s+and\s+placement\s+officer\s+deputed\s+as\s+a\s+head/i.test(placementText)) {
            roleGap += '\n\nThe placements page says a Training and Placement Officer is deputed as head of the cell. It does not print that person\'s name, so no one is substituted from a different designation.';
          }
        } catch (error) {
          logger.warn({ err: error instanceof Error ? error.message : 'placement page failed' }, 'placement role page failed');
        }
      }
    }
  } else if (followUp && /\b(faculty|professors?|staff)\b/i.test(input.message) && entities.department) {
    facultyResolution = await resolveFacultyRequest(
      { action: 'list', departmentCode: entities.department, headsOnly: /\b(hod|head of)\b/i.test(input.message) },
      input.message,
    );
  } else if (facultyPlan) {
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
  let narrative: NarrativeDraft | null = null;
  let providerNote: string | undefined;
  let webCitations: Citation[] = [];
  let fromWeb = false;
  const rollNumbers = registrationNumbers(input.message);
  const nameTokens = requiredNameTokens(input.message);
  if (rollNumbers.length) {
    if (!allowStudentLookup(input.sessionId)) {
      return persistAnswer(conversation._id, [
        {
          type: 'text',
          markdown: 'Too many student lookups from this browser. Wait a few minutes, then ask for one registration number.',
          citations: [],
        },
      ]);
    }
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
  let resolution: TimetableResolution | undefined =
    intent.type === 'timetable'
      ? resolveTimetableQuery({ ...entities, today: isoDateInKolkata() }, knowledge.timetables)
      : undefined;
  if (resolution?.status === 'match' && resolution.timetable.imageUrl && process.env.NODE_ENV !== 'test') {
    const cells = await readValidatedTimetable(resolution.timetable.imageUrl, input.signal);
    resolution = {
      ...resolution,
      verificationStatus: cells.length ? 'unverified' : resolution.verificationStatus,
      timetable: { ...resolution.timetable, entries: cells },
      note: cells.length
        ? 'Each listed period was found in the timetable image and confirmed by reading that cell again.'
        : 'The timetable image was retrieved. The period grid was not read, so no subjects or times are listed.',
    };
  }

  const answerIntent = facultyResolution ? 'faculty' : intent.type;
  const structured =
    resolution?.status === 'match' || resolution?.status === 'clarify' || Boolean(facultyResolution) || (intent.type === 'faculty' && knowledge.faculty.length > 0);
  const calendarCovered = intent.type !== 'calendar' || indexAnswersCalendar(input.message, knowledge.chunks);
  const indexSupports =
    !facultyResolution &&
    knowledge.chunks.length > 0 &&
    resolution?.status !== 'clarify' &&
    calendarCovered &&
    chunksSupportQuestion(input.message, knowledge.chunks, intent.type);
  const canNarrate = resolution?.status !== 'match' && indexSupports && knowledge.chunks.some((chunk) => chunk.allowAiInput !== false);
  if (canNarrate && !followUp && !comparative && !input.signal?.aborted) {
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

  const accepted = () => Boolean(narrative && narrative.confidence !== 'insufficient' && !/could not be verified/i.test(narrative.markdown));
  const rateLimited = /rate limit/i.test(providerNote ?? '');
  let evidenceText = knowledge.chunks.map((chunk) => `${chunk.title}\n${chunk.text}`).join('\n');
  let directMessage: string | undefined;
  let trustUnreadFile = false;
  let agentHandled = false;
  const calendarQuestion = intent.type === 'calendar';
  if (!roleGap && !accepted() && !structured && !rateLimited && intent.type !== 'calendar' && process.env.NODE_ENV !== 'test' && !input.signal?.aborted) {
    const prior = (await Message.find({ conversationId: conversation._id }).sort({ createdAt: -1 }).limit(8).lean()) as {
      role?: string;
      content?: string;
      blocks?: AnswerBlock[];
    }[];
    const history = prior
      .slice(1)
      .reverse()
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({
        role: String(row.role),
        content: (row.content || plainText(row.blocks ?? [])).slice(0, 800),
      }))
      .filter((row) => row.content);
    const python = await askPythonAgent({
      message: input.message,
      conversationId: String(conversation._id),
      history,
      signal: input.signal,
      onStatus: input.onStatus,
      onToken: input.onToken,
    });
    if (python) {
      agentHandled = true;
      void AgentRun.create({
        query: input.message.slice(0, 500),
        intent: python.intent,
        tools: python.attempts.map((attempt) => attempt.step),
        provider: 'python',
        failure: python.status === 'answered' ? undefined : python.attempts.find((attempt) => !attempt.ok)?.detail,
      }).catch(() => undefined);
      const pictures = python.evidence.filter(
        (item) => item.sourceType === 'image' && item.sourceUrl.startsWith('https://') && !isDecorativeImageUrl(item.sourceUrl),
      );
      if (pictures.length && (intent.wantsImages || intent.type === 'image')) {
        knowledge.images = pictures.map((item) => ({
          id: item.sourceUrl,
          url: item.sourceUrl,
          pageUrl: item.pageUrl || item.sourceUrl,
          title: item.documentTitle,
          alt: item.documentTitle,
          caption: item.extractedText,
          topic: imageTopic(item.sourceUrl),
        }));
      }
      if (python.status === 'answered') {
        evidenceText = python.evidence.map((item) => item.extractedText).join('\n');
        knowledge.chunks = python.evidence.map((item, index) => ({
          id: item.sourceUrl || String(index),
          title: item.documentTitle || 'Official college source',
          text: item.extractedText,
          url: item.sourceUrl,
          pageNumber: item.pageNumber,
          verificationStatus: 'unverified' as const,
          lexicalScore: 1,
          semanticScore: 0,
          sourceType: item.sourceType === 'pdf' ? 'document' as const : 'webpage' as const,
        }));
        fromWeb = true;
        webCitations = python.evidence.map((item) => ({
          id: item.sourceUrl,
          title: item.documentTitle || 'Official college source',
          url: item.sourceUrl,
          pageNumber: item.pageNumber,
          retrievedAt: item.capturedAt,
          verificationStatus: 'unverified' as const,
          sourceType: item.sourceType === 'pdf' ? 'document' as const : 'webpage' as const,
        }));
        narrative = {
          markdown: dropUnrelatedAmounts(python.answer),
          citationIds: webCitations.map((citation) => citation.id),
          relatedQuestions: [],
          confidence: 'inferred',
        };
      } else if (!knowledge.images.length) {
        directMessage = dropUnrelatedAmounts(python.answer);
      } else {
        narrative = {
          markdown: 'These photographs were retrieved from the official college site.',
          citationIds: pictures.map((item) => item.pageUrl || item.sourceUrl),
          relatedQuestions: [],
          confidence: 'inferred',
        };
        fromWeb = true;
        webCitations = pictures.map((item) => ({
          id: item.pageUrl || item.sourceUrl,
          title: item.documentTitle || 'Official photograph',
          url: item.pageUrl || item.sourceUrl,
          retrievedAt: item.capturedAt,
          verificationStatus: 'unverified' as const,
          sourceType: 'image' as const,
        }));
      }
    } else {
      const agent = await runCollegeAgent({
        message: input.message,
        intent: intent.type,
        signal: input.signal,
        onStatus: input.onStatus,
      });
      agentHandled = agent.handled;
      void AgentRun.create({
        query: input.message.slice(0, 500),
        intent: intent.type,
        tools: agent.tools.map((tool) => tool.name),
        failure: agent.tools.find((tool) => !tool.ok)?.detail,
      }).catch(() => undefined);
      if (agent.directMessage) directMessage = agent.directMessage;
      else if (agent.chunks.length) {
        knowledge.chunks = agent.chunks;
        evidenceText = agent.chunks.map((chunk) => `${chunk.title}\n${chunk.text}`).join('\n');
        try {
          const text = input.onToken
            ? await streamNarrative(input.message, agent.chunks, input.onToken, input.signal)
            : (await generateNarrative(input.message, agent.chunks, input.signal))?.markdown ?? '';
          if (text && !/could not be verified/i.test(text)) {
            fromWeb = true;
            webCitations = agent.evidence.map((item) => ({
              id: item.sourceUrl,
              title: item.documentTitle || 'Official college source',
              url: item.sourceUrl,
              pageNumber: item.pageNumber,
              retrievedAt: item.capturedAt,
              verificationStatus: 'unverified' as const,
              sourceType: item.sourceType === 'pdf' ? 'document' as const : 'webpage' as const,
            }));
            narrative = {
              markdown: text,
              citationIds: webCitations.map((citation) => citation.id),
              relatedQuestions: [],
              confidence: 'inferred',
            };
          }
        } catch (error) {
          if (input.signal?.aborted) throw error;
          providerNote = error instanceof ProviderError ? error.message : providerNote;
        }
      }
    }
  }
  if (!agentHandled && !accepted() && !structured && !rateLimited && calendarQuestion && !calendarCovered && !input.signal?.aborted) {
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
        if (text && !/could not be verified|not visible/i.test(text)) {
          fromWeb = true;
          trustUnreadFile = Boolean(calendar.pdf);
          evidenceText = calendar.text || text;
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
            markdown: text,
            citationIds: [calendar.url],
            relatedQuestions: [],
            confidence: 'inferred' as const,
          };
          knowledge.chunks = [];
          providerNote = undefined;
        } else {
          directMessage = `The official academic calendar file is published, but the requested dates could not be read from it. I will not copy dates from an older calendar.`;
        }
      } else {
        directMessage = 'The official academic calendar listing did not include a file for that question. I will not guess the dates.';
      }
    } catch (error) {
      if (input.signal?.aborted) throw error;
      providerNote = error instanceof ProviderError ? error.message : 'The academic calendar could not be read.';
      logger.warn({ err: (error instanceof Error ? error.message : providerNote).replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]') }, 'calendar read failed');
      directMessage = 'The official academic calendar could not be read. I will not guess the dates.';
    }
  }
  const calendarAnswered = accepted() && calendarQuestion;
  let officialAttempted = false;
  if (!agentHandled && !accepted() && !directMessage && !structured && !indexSupports && process.env.NODE_ENV !== 'test' && !input.signal?.aborted && officialTargetsFor(intent.type).length) {
    officialAttempted = true;
    input.onStatus?.('Opening the official college page');
    try {
      const pages = await loadOfficialTopicPages(intent.type, input.signal);
      const relevant = pages.filter((page) => pageAnswersQuestion(input.message, page.text));
      const todayMissing = intent.type === 'notice' && /\btoday\b/i.test(input.message) && !evidenceHasToday(pages.map((page) => page.text).join('\n'));
      if (todayMissing || !relevant.length) {
        directMessage = todayMissing
          ? 'No announcement dated today was found on the official notice page. I will not invent one.'
          : unverifiedMessage();
      } else {
        evidenceText = relevant.map((page) => page.text).join('\n');
        const chunks = relevant.map((page) => ({
          id: page.url,
          title: page.title,
          text: page.text,
          url: page.url,
          verificationStatus: 'unverified' as const,
          lexicalScore: 1,
          semanticScore: 0,
          sourceType: 'webpage' as const,
        }));
        knowledge.chunks = chunks;
        const text = rateLimited
          ? ''
          : input.onToken
            ? await streamNarrative(input.message, chunks, input.onToken, input.signal)
            : (await generateNarrative(input.message, chunks, input.signal))?.markdown ?? '';
        if (text && !/could not be verified/i.test(text)) {
          fromWeb = true;
          webCitations = relevant.map((page) => ({
            id: page.url,
            title: page.title,
            url: page.url,
            retrievedAt: new Date().toISOString(),
            verificationStatus: 'unverified' as const,
            sourceType: 'webpage' as const,
          }));
          narrative = {
            markdown: `${text}\n\n_Read from the official college page because the index did not answer this._`,
            citationIds: webCitations.map((citation) => citation.id),
            relatedQuestions: [],
            confidence: 'inferred' as const,
          };
          knowledge.chunks = [];
          providerNote = undefined;
        } else {
          narrative = null;
          fromWeb = true;
          webCitations = relevant.map((page) => ({
            id: page.url,
            title: page.title,
            url: page.url,
            retrievedAt: new Date().toISOString(),
            verificationStatus: 'unverified' as const,
            sourceType: 'webpage' as const,
          }));
        }
      }
    } catch (error) {
      if (input.signal?.aborted) throw error;
      logger.warn({ err: error instanceof Error ? error.message : 'official page failed' }, 'official page failed');
      if (!knowledge.chunks.length) directMessage = unverifiedMessage();
    }
  }
  if (!agentHandled && !accepted() && !calendarAnswered && !directMessage && !structured && !rateLimited && !indexSupports && !officialAttempted && !input.signal?.aborted) {
    input.onStatus?.('Not in the college index. Checking official public pages');
    try {
      const provider = getProvider();
      if (!provider.searchWeb) throw new ProviderError('NOT_CONFIGURED', 'Web search is not available');
      const web = await provider.searchWeb({
        system: WEB_SYSTEM_PROMPT,
        user: input.message,
        signal: input.signal,
        onToken: input.onToken,
      });
      webCitations = web.sources
        .filter((source) => source.url)
        .map((source) => ({
          id: source.url,
          title: source.title,
          url: source.url,
          retrievedAt: new Date().toISOString(),
          verificationStatus: 'unverified' as const,
          sourceType: 'webpage' as const,
        }));
      fromWeb = true;
      narrative = {
        markdown: web.text,
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
          ? 'Gemini could not finish a search of the college site. Wait a moment and ask again.'
          : error instanceof ProviderError
            ? error.message
            : 'Web search is temporarily unavailable.';
      const detail = error instanceof Error ? error.message : providerNote;
      logger.warn({ err: detail.replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]') }, 'web search failed');
      if (error instanceof ProviderError && error.code === 'RATE_LIMIT') knowledge.chunks = [];
    }
  }

  if (narrative && !trustUnreadFile && !figuresSupported(narrative.markdown, evidenceText, input.message)) {
    narrative = null;
    if (!indexSupports) directMessage = unverifiedMessage();
  }

  if (roleGap) {
    narrative = null;
    directMessage = roleGap;
    knowledge.faculty = [];
  }
  if (intent.type === 'image' && !knowledge.images.length && !directMessage && !roleGap) {
    directMessage = 'I could not retrieve a verified photograph from the official LBRCE gallery. No image is shown in place of one.';
  }
  const assembled = assembleBlocks({
    intent: answerIntent,
    chunks: knowledge.chunks,
    images: intent.wantsImages || intent.type === 'image' ? knowledge.images : [],
    faculty: knowledge.faculty,
    facultyResolution,
    resolution,
    narrative: directMessage ? null : narrative,
    providerNote,
    externalCitations: webCitations,
    narrativeFromWeb: fromWeb,
    directMessage,
  });
  if (providerNote && assembled.blocks.every((block) => block.type !== 'text')) {
    assembled.blocks = [
      { type: 'text', markdown: providerNote, citations: [] },
      ...assembled.blocks.filter((block) => block.type !== 'insufficient_evidence'),
    ];
  }
  if (rosterRefusal) {
    assembled.blocks.unshift({
      type: 'text',
      markdown:
        'I cannot provide a complete class roster, including names and registration numbers, through this public chat. The timetable below is separate from that list.',
      citations: [],
    });
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

function allowStudentLookup(sessionId: string): boolean {
  const now = Date.now();
  const recent = (studentLookups.get(sessionId) ?? []).filter((time) => now - time < 15 * 60 * 1000);
  if (recent.length >= 8) {
    studentLookups.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  studentLookups.set(sessionId, recent);
  return true;
}

async function persistAnswer(conversationId: unknown, blocks: AnswerBlock[], relatedQuestions: string[] = []): Promise<ChatResponse> {
  const assistant = await Message.create({
    conversationId,
    role: 'assistant',
    content: plainText(blocks),
    blocks,
    relatedQuestions,
    status: 'complete',
  });
  return {
    conversationId: String(conversationId),
    messageId: String(assistant._id),
    blocks,
    relatedQuestions,
  };
}

async function getConversation(sessionId: string, conversationId: string | undefined, message: string) {
  if (conversationId) {
    const existing = await Conversation.findOne({ _id: conversationId, sessionId });
    if (existing) return existing;
  }
  return Conversation.create({ sessionId, title: message.slice(0, 80) });
}

function chunksSupportQuestion(message: string, chunks: ScoredChunk[], intent: ReturnType<typeof detectIntent>['type']): boolean {
  if (asksForInstitutionalRole(message)) {
    const blob = chunks.map((chunk) => `${chunk.title} ${chunk.text}`).join('\n');
    return evidenceSupportsRequestedRole(message, blob);
  }
  if (!chunksAnswerQuestion(message, chunks, intent, topicPattern(intent))) return false;
  if (topicPattern(intent) || intent === 'fee' || intent === 'placement' || intent === 'admission' || intent === 'department') return true;
  return chunksMatchQuestion(message, chunks);
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
  const tokens = [...new Set([...message.matchAll(/\b[A-Za-z]{4,}\b/g)].map((match) => match[0].toUpperCase()).filter((token) => !stop.has(token.toLowerCase())))];
  return tokens.length >= 2 ? tokens : [];
}

async function calendarContinuation(conversationId: unknown, message: string): Promise<string> {
  const prior = (await Message.findOne({ conversationId, role: 'assistant' }).sort({ createdAt: -1 }).lean()) as { blocks?: unknown } | null;
  const priorText = JSON.stringify(prior?.blocks ?? '');
  if (/^\s*20\d{2}(?:\s*[-–]\s*\d{2,4})?\s*$/.test(message) && priorText.includes('Which academic year')) {
    return `Academic calendar ${message.trim()}`;
  }
  const regulation = message.match(/\bR\d{2}\b/i)?.[0];
  if (regulation && priorText.includes('Which one should I read')) {
    const earlier = (await Message.find({ conversationId, role: 'user' }).sort({ createdAt: -1 }).limit(4).lean()) as { content?: string }[];
    const year = earlier.map((row) => String(row.content ?? '')).join(' ').match(/20\d{2}(?:\s*[-–]\s*\d{2,4})?/)?.[0] ?? '';
    return `Academic calendar ${year} ${regulation}`.trim();
  }
  return message;
}

function dropUnrelatedAmounts(answer: string): string {
  if (/different amounts/i.test(answer)) return unverifiedMessage();
  return answer;
}

function calendarReadout(title: string, text: string, url: string, chosen?: string): string {
  const regulations = [...new Set([...text.matchAll(/\bR\d{2}\b/g)].map((match) => match[0] ?? ''))].filter(Boolean);
  const lines = chosen ? linesForRegulation(text, chosen) : [];
  const regulationLine = chosen
    ? `Selected regulation: ${chosen.toUpperCase()}. Only date lines from the ${chosen.toUpperCase()} pages are listed. A line with a corrupted date was left out.`
    : regulations.length
      ? `Regulation marks printed in this file: ${regulations.join(', ')}.`
      : 'No separate regulation code was extracted from the file.';
  const details = lines.length
    ? lines.map((line) => `- ${line}`).join('\n')
    : chosen
      ? `No validated ${chosen.toUpperCase()} date was read. No dates are guessed.`
      : 'The PDF was downloaded. Dates could not be read from its text, so none are guessed. The original file is shown below.';
  return [`**${title}**`, regulationLine, details, `[Official calendar file](${url})`].join('\n\n');
}

function wantsCalendarPicture(message: string): boolean {
  if (!/\b(academic\s+cal[ae]nd[ae]r|cal[ae]nd[ae]r)\b/i.test(message)) return false;
  if (/\b(when|what date|which date|holiday|sankranthi|sankranti|pongal|exam)\b/i.test(message)) return false;
  return /\b(show|fetch|get|download|open|give|send|display)\b/i.test(message) || /^\s*academic calendar\s+20\d{2}/i.test(message);
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
      if (block.type === 'evidence') return block.title ?? 'Official evidence';
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

export async function renameConversation(id: string, sessionId: string, title: string) {
  const trimmed = title.trim().slice(0, 80);
  if (!trimmed) return null;
  return Conversation.findOneAndUpdate({ _id: id, sessionId }, { title: trimmed }, { new: true }).lean();
}

export async function deleteConversation(id: string, sessionId: string) {
  const conversation = await Conversation.findOneAndDelete({ _id: id, sessionId });
  if (!conversation) return false;
  await Message.deleteMany({ conversationId: id });
  return true;
}
