import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { documentMetaSchema, loginRequestSchema, timetablePatchSchema } from '@lbrce/shared';
import { getEnv } from '../config/env.js';
import {
  AuditLog,
  CollegeImage,
  CollegeSource,
  CrawledPage,
  Document,
  DocumentChunk,
  IngestionJob,
  Timetable,
  TimetableEntry,
} from '../models/index.js';
import { login } from '../services/auth.service.js';
import { archiveDocument, enqueueCrawl, ingestUpload, publishExtractedDocument } from '../services/ingestion.service.js';
import { detectUpload } from '../security/files.js';
import { detectIntent, extractEntities } from '../retrieval/intent.js';
import { searchKnowledge } from '../retrieval/search.js';
import { HttpError } from '../utils/http-error.js';

export async function adminLogin(req: Request, res: Response): Promise<void> {
  const body = loginRequestSchema.parse(req.body);
  const result = await login(body.email, body.password);
  const env = getEnv();
  res.cookie('lbrce_admin', result.token, {
    httpOnly: true,
    sameSite: env.COOKIE_SAMESITE,
    secure: env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });
  res.json({ user: result.user, token: result.token });
}

export async function adminLogout(_req: Request, res: Response): Promise<void> {
  res.clearCookie('lbrce_admin', { path: '/' });
  res.json({ ok: true });
}

export async function adminMe(req: Request, res: Response): Promise<void> {
  res.json({ user: req.admin });
}

export async function dashboard(_req: Request, res: Response): Promise<void> {
  const [pages, documents, chunks, images, jobs, pendingDocs, pendingTimetables, sources, latestSuccess] = await Promise.all([
    CrawledPage.countDocuments(),
    Document.countDocuments(),
    DocumentChunk.countDocuments({ published: true }),
    CollegeImage.countDocuments(),
    IngestionJob.countDocuments({ status: 'failed' }),
    Document.countDocuments({ origin: 'upload', status: 'extracted' }),
    Timetable.countDocuments({ verificationStatus: 'unverified' }),
    CollegeSource.find().lean(),
    IngestionJob.findOne({ status: 'succeeded' }).sort({ finishedAt: -1 }).lean() as Promise<any>,
  ]);
  res.json({
    pages,
    documents,
    chunks,
    images,
    failedJobs: jobs,
    documentsAwaitingVerification: pendingDocs,
    timetablesAwaitingVerification: pendingTimetables,
    sources: sources.map((source) => ({
      id: String(source._id),
      name: source.name,
      baseUrl: source.baseUrl,
      health: source.health,
      lastCrawledAt: source.lastCrawledAt,
      lastSuccessAt: source.lastSuccessAt,
      lastError: source.lastError,
      allowAiInput: source.allowAiInput,
    })),
    latestSuccessAt: latestSuccess?.finishedAt ?? null,
    vectorSearch: getEnv().VECTOR_SEARCH_INDEX ? 'atlas' : 'local-cosine',
    geminiConfigured: Boolean(getEnv().GEMINI_API_KEY),
    ocrEnabled: getEnv().OCR_ENABLED,
  });
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  if (!req.file) throw new HttpError(400, 'VALIDATION_ERROR', 'A file is required');
  const detected = detectUpload(req.file.buffer, req.file.originalname, getEnv().OCR_ENABLED);
  if (!detected) throw new HttpError(400, 'UNSUPPORTED_FILE', 'The file type is not allowed or does not match its contents');
  const meta = documentMetaSchema.parse(JSON.parse(String(req.body.meta ?? '{}')));
  const id = await ingestUpload({
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    mimeType: detected.mime,
    meta,
    userId: req.admin?.sub,
  });
  await AuditLog.create({ actorId: req.admin?.sub, action: 'document.upload', targetType: 'Document', targetId: id });
  const document = (await Document.findById(id).lean()) as any;
  res.status(201).json({ id, document });
}

export async function adminDocument(req: Request, res: Response): Promise<void> {
  const document = (await Document.findById(param(req)).lean()) as any;
  if (!document) throw new HttpError(404, 'NOT_FOUND', 'Document not found');
  const chunks = await DocumentChunk.find({ documentId: document._id }).sort({ chunkIndex: 1 }).limit(20).lean();
  res.json({ document, chunks });
}

export async function adminDocuments(_req: Request, res: Response): Promise<void> {
  const rows = await Document.find().sort({ createdAt: -1 }).limit(50).lean();
  res.json({ data: rows });
}

export async function publishDocument(req: Request, res: Response): Promise<void> {
  await publishExtractedDocument(param(req), true);
  await AuditLog.create({ actorId: req.admin?.sub, action: 'document.publish', targetType: 'Document', targetId: param(req) });
  res.json({ ok: true });
}

export async function archive(req: Request, res: Response): Promise<void> {
  await archiveDocument(param(req));
  await AuditLog.create({ actorId: req.admin?.sub, action: 'document.archive', targetType: 'Document', targetId: param(req) });
  res.json({ ok: true });
}

export async function reprocess(req: Request, res: Response): Promise<void> {
  const document = await Document.findById(param(req));
  if (!document) throw new HttpError(404, 'NOT_FOUND', 'Document not found');
  const job = await IngestionJob.create({ type: 'reprocess', status: 'queued', documentId: document._id, logs: ['Reprocess queued'] });
  res.status(202).json({ jobId: job.id });
}

export async function runIngestion(req: Request, res: Response): Promise<void> {
  const jobId = await enqueueCrawl();
  await AuditLog.create({ actorId: req.admin?.sub, action: 'ingestion.run', targetType: 'IngestionJob', targetId: jobId });
  res.status(202).json({ jobId });
}

export async function ingestionStatus(_req: Request, res: Response): Promise<void> {
  const jobs = await IngestionJob.find().sort({ createdAt: -1 }).limit(20).lean();
  res.json({ data: jobs });
}

export async function retryJob(req: Request, res: Response): Promise<void> {
  const job = await IngestionJob.findById(param(req));
  if (!job) throw new HttpError(404, 'NOT_FOUND', 'Job not found');
  if (job.status !== 'failed') throw new HttpError(409, 'CONFLICT', 'Only failed jobs can be retried');
  job.status = 'queued';
  job.error = undefined;
  job.logs.push('Retry queued');
  await job.save();
  res.json({ ok: true });
}

export async function verifyTimetable(req: Request, res: Response): Promise<void> {
  const id = String(req.body?.id ?? '');
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'VALIDATION_ERROR', 'id is required');
  const timetable = await Timetable.findByIdAndUpdate(id, { verificationStatus: 'verified' }, { new: true });
  if (!timetable) throw new HttpError(404, 'NOT_FOUND', 'Timetable not found');
  await AuditLog.create({ actorId: req.admin?.sub, action: 'timetable.verify', targetType: 'Timetable', targetId: id });
  res.json({ id, verificationStatus: timetable.verificationStatus });
}

export async function patchTimetable(req: Request, res: Response): Promise<void> {
  const body = timetablePatchSchema.parse(req.body);
  const timetable = await Timetable.findById(param(req));
  if (!timetable) throw new HttpError(404, 'NOT_FOUND', 'Timetable not found');
  const { entries, effectiveFrom, effectiveUntil, ...rest } = body;
  Object.assign(timetable, rest);
  if (effectiveFrom) timetable.effectiveFrom = new Date(effectiveFrom);
  if (effectiveUntil) timetable.effectiveUntil = new Date(effectiveUntil);
  if (timetable.verificationStatus === 'verified') timetable.verificationStatus = 'unverified';
  await timetable.save();
  if (entries) {
    await TimetableEntry.deleteMany({ timetableId: timetable._id });
    if (entries.length) {
      await TimetableEntry.insertMany(
        entries.map((entry) => ({
          ...entry,
          entryType: entry.entryType ?? 'lecture',
          timetableId: timetable._id,
          confidence: 1,
          sourceUrl: timetable.sourceUrl,
        })),
      );
    }
  }
  await AuditLog.create({ actorId: req.admin?.sub, action: 'timetable.patch', targetType: 'Timetable', targetId: timetable.id });
  const savedEntries = await TimetableEntry.find({ timetableId: timetable._id }).lean();
  res.json({ timetable, entries: savedEntries });
}

export async function adminTimetables(_req: Request, res: Response): Promise<void> {
  const rows = await Timetable.find().sort({ updatedAt: -1 }).limit(50).lean();
  res.json({ data: rows });
}

export async function retrievalDiagnostics(req: Request, res: Response): Promise<void> {
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
      lexicalScore: chunk.lexicalScore,
      semanticScore: chunk.semanticScore,
      verificationStatus: chunk.verificationStatus,
      excerpt: chunk.text.slice(0, 280),
    })),
    timetableCount: knowledge.timetables.length,
    imageCount: knowledge.images.length,
    facultyCount: knowledge.faculty.length,
  });
}

function param(req: Request): string {
  const value = req.params.id;
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !mongoose.isValidObjectId(id)) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid id');
  return id;
}
