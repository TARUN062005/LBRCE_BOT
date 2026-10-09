import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { chatRequestSchema, feedbackRequestSchema, paginationQuerySchema, timetableSearchQuerySchema } from '@lbrce/shared';
import { CrawledPage, CollegeImage, Document, Feedback, Message, Timetable, TimetableEntry } from '../models/index.js';
import { answerQuestion, deleteConversation, getConversationMessages, listConversations } from '../services/chat.service.js';
import { detectIntent, extractEntities } from '../retrieval/intent.js';
import { searchKnowledge } from '../retrieval/search.js';
import { HttpError } from '../utils/http-error.js';
import { isoDateInKolkata } from '../utils/time.js';
import { resolveTimetableQuery } from '../timetable/resolve.js';

export async function postChat(req: Request, res: Response): Promise<void> {
  const body = chatRequestSchema.parse(req.body);
  const result = await answerQuestion(body);
  res.status(200).json(result);
}

export async function streamChat(req: Request, res: Response): Promise<void> {
  const body = chatRequestSchema.parse(req.body);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on('close', abort);
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    const result = await answerQuestion({
      ...body,
      signal: controller.signal,
      onStatus: (status) => send('status', { status }),
      onToken: (token) => send('token', { token }),
    });
    if (!controller.signal.aborted) send('done', result);
  } catch {
    send('error', { message: 'The response stopped before it could be saved.' });
  } finally {
    req.off('close', abort);
    res.end();
  }
}

export async function chatHistory(req: Request, res: Response): Promise<void> {
  const sessionId = String(req.query.sessionId ?? '');
  if (sessionId.length < 8) throw new HttpError(400, 'VALIDATION_ERROR', 'sessionId is required');
  const rows = await listConversations(sessionId);
  res.json({
    data: rows.map((row) => ({ id: String(row._id), title: row.title, updatedAt: row.updatedAt })),
  });
}

export async function chatById(req: Request, res: Response): Promise<void> {
  const sessionId = String(req.query.sessionId ?? '');
  const result = await getConversationMessages(param(req), sessionId);
  if (!result) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found');
  res.json({
    conversation: { id: String(result.conversation._id), title: result.conversation.title },
    messages: result.messages.map((message) => ({
      id: String(message._id),
      role: message.role,
      content: message.content,
      blocks: message.blocks,
      relatedQuestions: message.relatedQuestions,
      createdAt: message.createdAt,
    })),
  });
}

export async function removeChat(req: Request, res: Response): Promise<void> {
  const sessionId = String(req.query.sessionId ?? '');
  const removed = await deleteConversation(param(req), sessionId);
  if (!removed) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found');
  res.status(204).end();
}

export async function search(req: Request, res: Response): Promise<void> {
  const query = String(req.query.q ?? '').trim();
  if (!query) throw new HttpError(400, 'VALIDATION_ERROR', 'q is required');
  const intent = detectIntent(query);
  const entities = extractEntities(query);
  const knowledge = await searchKnowledge(query, intent.type, entities);
  res.json({
    intent: intent.type,
    entities,
    chunks: knowledge.chunks.map((chunk) => ({
      id: chunk.id,
      title: chunk.title,
      url: chunk.url,
      pageNumber: chunk.pageNumber,
      verificationStatus: chunk.verificationStatus,
      excerpt: chunk.text.slice(0, 400),
    })),
    images: knowledge.images,
    faculty: knowledge.faculty,
  });
}

export async function sourceById(req: Request, res: Response): Promise<void> {
  const id = param(req);
  const [page, document, message] = (await Promise.all([
    CrawledPage.findById(id).lean(),
    Document.findById(id).lean(),
    Message.findById(id).lean(),
  ])) as any[];
  if (page) {
    res.json({ type: 'webpage', id, title: page.title, url: page.url, retrievedAt: page.retrievedAt, text: page.text.slice(0, 5000) });
    return;
  }
  if (document) {
    res.json({
      type: 'document',
      id,
      title: document.title,
      url: document.sourceUrl,
      documentType: document.documentType,
      status: document.status,
      verificationStatus: document.verificationStatus,
      preview: document.preview,
    });
    return;
  }
  if (message) {
    res.json({ type: 'message', id, blocks: message.blocks });
    return;
  }
  throw new HttpError(404, 'NOT_FOUND', 'Source not found');
}

export async function listDocuments(req: Request, res: Response): Promise<void> {
  const query = paginationQuerySchema.parse(req.query);
  const filter: Record<string, unknown> = { status: 'published' };
  if (req.query.documentType) filter.documentType = String(req.query.documentType);
  if (query.q) filter.title = new RegExp(escapeRegex(query.q), 'i');
  const [total, rows] = (await Promise.all([
    Document.countDocuments(filter),
    Document.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
  ])) as [number, any[]];
  res.json({
    page: query.page,
    limit: query.limit,
    total,
    data: rows.map(presentDocument),
  });
}

export async function documentById(req: Request, res: Response): Promise<void> {
  const document = (await Document.findOne({ _id: param(req), status: 'published' }).lean()) as any;
  if (!document) throw new HttpError(404, 'NOT_FOUND', 'Document not found');
  res.json(presentDocument(document));
}

export async function searchTimetables(req: Request, res: Response): Promise<void> {
  const query = timetableSearchQuerySchema.parse(req.query);
  const knowledge = await searchKnowledge(query.q || `${query.department ?? ''} timetable`, 'timetable', {
    department: query.department,
    academicYear: query.academicYear,
    year: query.year,
    semester: query.semester,
    section: query.section?.toUpperCase(),
    day: query.day?.toLowerCase(),
  });
  const resolution = resolveTimetableQuery(
    {
      department: query.department,
      academicYear: query.academicYear,
      year: query.year,
      semester: query.semester,
      section: query.section?.toUpperCase(),
      day: query.day?.toLowerCase(),
      today: isoDateInKolkata(),
    },
    knowledge.timetables,
  );
  res.json({ resolution, timetables: knowledge.timetables });
}

export async function listTimetables(_req: Request, res: Response): Promise<void> {
  const rows = await Timetable.find({ verificationStatus: { $ne: 'rejected' } }).sort({ updatedAt: -1 }).limit(50).lean();
  res.json({ data: rows.map((row) => ({ ...row, id: String(row._id) })) });
}

export async function timetableById(req: Request, res: Response): Promise<void> {
  const timetable = (await Timetable.findById(param(req)).lean()) as any;
  if (!timetable) throw new HttpError(404, 'NOT_FOUND', 'Timetable not found');
  const entries = await TimetableEntry.find({ timetableId: timetable._id }).lean();
  res.json({ ...timetable, id: String(timetable._id), entries });
}

export async function searchImages(req: Request, res: Response): Promise<void> {
  const query = String(req.query.q ?? '').trim();
  if (!query) throw new HttpError(400, 'VALIDATION_ERROR', 'q is required');
  const knowledge = await searchKnowledge(query, 'image', extractEntities(query));
  res.json({ data: knowledge.images });
}

export async function postFeedback(req: Request, res: Response): Promise<void> {
  const body = feedbackRequestSchema.parse(req.body);
  if (!mongoose.isValidObjectId(body.messageId)) throw new HttpError(400, 'VALIDATION_ERROR', 'messageId is invalid');
  await Feedback.create(body);
  res.status(201).json({ ok: true });
}

export async function listImagesPreview(_req: Request, res: Response): Promise<void> {
  const rows = await CollegeImage.find().sort({ updatedAt: -1 }).limit(12).lean();
  res.json({ data: rows });
}

function presentDocument(document: { _id: unknown; title: string; sourceUrl?: string | null; documentType?: string | null; verificationStatus?: string | null; createdAt?: Date; preview?: string | null; status?: string | null }) {
  return {
    id: String(document._id),
    title: document.title,
    sourceUrl: document.sourceUrl,
    documentType: document.documentType,
    verificationStatus: document.verificationStatus,
    status: document.status,
    createdAt: document.createdAt,
    preview: document.preview,
  };
}

function param(req: Request): string {
  const value = req.params.id;
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !mongoose.isValidObjectId(id)) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid id');
  return id;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
