import type { AnswerBlock, ChatResponse } from '@lbrce/shared';
import { Conversation, Message } from '../models/index.js';
import { assembleBlocks } from '../retrieval/assemble.js';
import { detectIntent, extractEntities } from '../retrieval/intent.js';
import { generateNarrative, searchKnowledge, streamNarrative } from '../retrieval/search.js';
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
  const knowledge = await searchKnowledge(input.message, intent.type, entities);
  const resolution =
    intent.type === 'timetable'
      ? resolveTimetableQuery({ ...entities, today: isoDateInKolkata() }, knowledge.timetables)
      : undefined;

  let narrative = null;
  let providerNote: string | undefined;
  const canNarrate = knowledge.chunks.length > 0 && resolution?.status !== 'clarify';
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

  const assembled = assembleBlocks({
    intent: intent.type,
    chunks: knowledge.chunks,
    images: intent.wantsImages || intent.type === 'image' || intent.type === 'timetable' ? knowledge.images : [],
    faculty: knowledge.faculty,
    resolution,
    narrative,
    providerNote,
  });
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
