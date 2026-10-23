import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import robotsParser from 'robots-parser';
import { OFFICIAL_SEED_PATHS, OFFICIAL_SITE_URL } from '@lbrce/shared';
import { getEnv } from '../config/env.js';
import { fetchPublic } from '../integrations/college-sources/fetch.js';
import { parseContentSignals } from '../integrations/college-sources/signals.js';
import { looksLikeTimetableAsset, parseTimetableLocation } from '../timetable/filename.js';
import { chunkText } from '../ingestion/chunk.js';
import {
  classifyUrl,
  departmentFromUrl,
  extractDocx,
  extractHtmlPage,
  extractPdf,
  extractSpreadsheet,
  facultyFromTables,
  ocrImage,
  timetableEntriesFromText,
} from '../ingestion/extract.js';
import {
  CollegeImage,
  CollegeSource,
  CrawledPage,
  Department,
  Document,
  DocumentChunk,
  Faculty,
  IngestionJob,
  Timetable,
  TimetableEntry,
} from '../models/index.js';
import { sha256 } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { getProvider } from '../integrations/gemini/provider.js';
import type { ParsedEntry } from '../timetable/parse.js';

const USER_AGENT = 'LBRCE-AI-Bot/1.0';

export async function ingestOfficialUrl(url: string): Promise<number> {
  const source = await CollegeSource.findOne({ enabled: true }).sort({ createdAt: 1 });
  if (!source) throw new Error('No enabled college source is configured');
  const response = await fetchPublic(url, getEnv().allowedHosts);
  if (response.status >= 400) throw new Error(`HTTP ${response.status} for ${url}`);
  const extracted = extractHtmlPage(response.body.toString('utf8'), response.url);
  await storePage(source.id, response.url, response, source.allowAiInput !== false);
  return extracted.students.length;
}

export async function enqueueCrawl(): Promise<string> {
  const source = await CollegeSource.findOne({ enabled: true }).sort({ createdAt: 1 });
  if (!source) throw new Error('No enabled college source is configured');
  const job = await IngestionJob.create({ type: 'crawl', status: 'queued', sourceId: source._id, logs: ['Queued official website refresh'] });
  return job.id;
}

export async function processNextJob(): Promise<void> {
  const job = await IngestionJob.findOneAndUpdate(
    { status: 'queued' },
    { status: 'running', startedAt: new Date() },
    { sort: { createdAt: 1 }, new: true },
  );
  if (!job) return;
  try {
    if (job.type === 'crawl' || job.type === 'refresh') {
      job.stats = await crawlEnabledSource(String(job._id));
    } else if ((job.type === 'reprocess' || job.type === 'upload' || job.type === 'embed') && job.documentId) {
      await publishExtractedDocument(String(job.documentId), false);
      job.stats = { documentId: String(job.documentId) };
    }
    job.status = 'succeeded';
    job.finishedAt = new Date();
    await job.save();
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Ingestion failed';
    job.finishedAt = new Date();
    await job.save();
    logger.error({ err: job.error, jobId: job.id }, 'ingestion job failed');
  }
}

export function startWorker(): () => void {
  const timer = setInterval(() => {
    void processNextJob();
  }, 3000);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function crawlEnabledSource(jobId: string): Promise<Record<string, number>> {
  const env = getEnv();
  const source = await CollegeSource.findOne({ enabled: true }).sort({ createdAt: 1 });
  if (!source) throw new Error('No enabled college source is configured');
  const allowedHosts: string[] =
    Array.isArray(source.allowedHosts) && source.allowedHosts.length ? source.allowedHosts.map(String) : env.allowedHosts;
  const maxPages = Number(source.maxPages) || env.CRAWL_MAX_PAGES;
  const maxDocuments = Number(source.maxDocuments) || env.CRAWL_MAX_DOCUMENTS;
  const delayMs = Number(source.crawlDelayMs ?? env.CRAWL_DELAY_MS);
  const seedList: string[] =
    Array.isArray(source.seedPaths) && source.seedPaths.length ? source.seedPaths.map(String) : [...OFFICIAL_SEED_PATHS];
  const seeds = seedList.map((seedPath) => new URL(seedPath, String(source.baseUrl || OFFICIAL_SITE_URL)).toString());

  const robotsUrl = new URL('/robots.txt', source.baseUrl).toString();
  let robotsText = '';
  try {
    const robots = await fetchPublic(robotsUrl, allowedHosts);
    robotsText = robots.body.toString('utf8');
  } catch (error) {
    await log(jobId, `robots.txt could not be fetched: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  const signals = parseContentSignals(robotsText);
  const allowAiInput = signals.aiInput !== false;
  source.allowAiInput = allowAiInput;
  if (signals.aiInput === false) {
    await log(jobId, 'Content signal ai-input=no. Pages will be indexed for excerpts and links, not sent to the model.');
  }
  const robots = robotsParser(robotsUrl, robotsText || 'User-agent: *\nAllow: /\n');

  const seedQueue: string[] = [...new Set(seeds)];
  const discoveredQueue: string[] = [];
  const seen = new Set<string>();
  let pages = 0;
  let documents = 0;
  let images = 0;
  let failures = 0;

  while (seedQueue.length || discoveredQueue.length) {
    if (pages >= maxPages && documents >= maxDocuments) break;
    const url = takeNextUrl(seedQueue, discoveredQueue, pages < maxPages, documents < maxDocuments);
    if (!url) break;
    if (seen.has(url)) continue;
    seen.add(url);
    if (robots.isAllowed(url, USER_AGENT) === false) {
      await log(jobId, `Skipped by robots.txt: ${url}`);
      continue;
    }
    if (!isUsefulUrl(url)) continue;
    await sleep(delayMs);
    try {
      const response = await fetchPublic(url, allowedHosts);
      const headerSignals = parseContentSignals('', response.contentSignal);
      const pageAllowsAi = allowAiInput && headerSignals.aiInput !== false;
      if (response.status >= 400) {
        failures += 1;
        await log(jobId, `HTTP ${response.status} for ${url}`);
        continue;
      }
      const type = response.contentType.toLowerCase();
      if (type.includes('html') || looksLikeHtml(response.body)) {
        pages += 1;
        const discovered = await storePage(source.id, response.url, response, pageAllowsAi);
        images += discovered.images;
        for (const link of discovered.links) {
          if (!seen.has(link) && isUsefulUrl(link) && hostIsAllowed(link, allowedHosts)) {
            discoveredQueue.push(link);
          }
        }
        discoveredQueue.sort((a, b) => priority(a) - priority(b));
      } else if (documents < maxDocuments && isDocument(type, response.url)) {
        documents += 1;
        await storeRemoteDocument(source.id, response, pageAllowsAi);
      }
    } catch (error) {
      failures += 1;
      await log(jobId, `Failed ${url}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  source.lastCrawledAt = new Date();
  source.lastSuccessAt = failures && !pages ? source.lastSuccessAt : new Date();
  source.health = failures && !pages ? 'failed' : failures ? 'degraded' : 'healthy';
  source.lastError = failures ? `${failures} request(s) failed` : undefined;
  await source.save();
  await log(jobId, `Finished pages=${pages} documents=${documents} images=${images} failures=${failures}`);
  return { pages, documents, images, failures };
}

async function storePage(
  sourceId: string,
  url: string,
  response: { body: Buffer; contentType: string; lastModified?: string },
  allowAiInput: boolean,
): Promise<{ links: string[]; images: number }> {
  const extracted = extractHtmlPage(response.body.toString('utf8'), url);
  const contentHash = sha256(extracted.text);
  const existing = await CrawledPage.findOne({ url });
  if (existing && existing.contentHash === contentHash) {
    const studentChunks = extracted.students.length
      ? await DocumentChunk.countDocuments({ pageId: existing._id, 'metadata.documentType': 'student' })
      : 1;
    if (studentChunks > 0) {
      existing.retrievedAt = new Date();
      await existing.save();
      return { links: extracted.links, images: 0 };
    }
  }
  const page = await CrawledPage.findOneAndUpdate(
    { url },
    {
      sourceId,
      url,
      title: extracted.title,
      headings: extracted.headings,
      text: extracted.text,
      contentHash,
      contentType: response.contentType,
      statusCode: 200,
      lastModified: response.lastModified,
      retrievedAt: new Date(),
      allowAiInput,
    },
    { upsert: true, new: true },
  );
  const documentType = classifyUrl(url);
  const department = departmentFromUrl(url);
  await DocumentChunk.deleteMany({ pageId: page._id });
  const chunks = chunkText(extracted.text).slice(0, 40).map((chunk) => ({
    pageId: page._id,
    sourceUrl: url,
    title: extracted.title,
    text: chunk.text,
    heading: chunk.heading,
    pageNumber: chunk.pageNumber,
    chunkIndex: chunk.index,
    contentHash: sha256(chunk.text),
    metadata: { department, documentType },
    verificationStatus: 'unverified',
    published: true,
    allowAiInput,
    retrievedAt: new Date(),
  }));
  for (let index = 0; index < extracted.students.length; index += 12) {
    const text = extracted.students
      .slice(index, index + 12)
      .map((student) => `${student.name} | Registration number: ${student.registrationNumber}`)
      .join('\n');
    chunks.push({
      pageId: page._id,
      sourceUrl: url,
      title: extracted.title,
      text: `Student registration list\n${text}`,
      heading: 'Student registration list',
      pageNumber: undefined,
      chunkIndex: chunks.length,
      contentHash: sha256(text),
      metadata: { department, documentType: 'student' },
      verificationStatus: 'unverified',
      published: true,
      allowAiInput,
      retrievedAt: new Date(),
    });
  }
  if (chunks.length) await DocumentChunk.insertMany(chunks);
  await embedChunks(
    chunks.filter((chunk) => chunk.metadata.documentType !== 'student').map((chunk) => chunk.contentHash),
    { pageId: page._id },
  );

  let imageCount = 0;
  for (const image of extracted.images) {
    if (!hostIsAllowed(image.url, getEnv().allowedHosts)) continue;
    await CollegeImage.updateOne(
      { sourceUrl: image.url },
      {
        sourceUrl: image.url,
        pageUrl: url,
        title: image.title || extracted.title,
        alt: image.alt,
        caption: image.caption,
        context: image.context || extracted.title,
        topic: topicFor(image.url, url),
        host: new URL(image.url).hostname,
      },
      { upsert: true },
    );
    imageCount += 1;
    if (looksLikeTimetableAsset(image.url)) {
      await upsertTimetableShell(image.url, url, department, []);
    }
  }

  const people = facultyFromTables(extracted.tables, url, department);
  for (const person of people) {
    await Faculty.updateOne(
      { sourceUrl: url, name: person.name },
      { ...person, verificationStatus: 'unverified' },
      { upsert: true },
    );
    if (person.isHead && person.department) {
      await Department.updateOne(
        { code: person.department },
        { code: person.department, name: person.department, hodName: person.name, sourceUrl: url, pageUrl: url },
        { upsert: true },
      );
    }
  }
  return { links: extracted.links, images: imageCount };
}

async function storeRemoteDocument(
  sourceId: string,
  response: { url: string; body: Buffer; contentType: string },
  allowAiInput: boolean,
): Promise<void> {
  const hash = sha256(response.body);
  const existing = await Document.findOne({ contentHash: hash, sourceUrl: response.url });
  if (existing) return;
  const env = getEnv();
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  const filename = `${hash.slice(0, 16)}${path.extname(new URL(response.url).pathname) || '.bin'}`;
  const storagePath = path.join(env.UPLOAD_DIR, filename);
  await writeFile(storagePath, response.body);
  const extracted = await extractBuffer(response.body, response.contentType, response.url, env.OCR_ENABLED);
  const department = departmentFromUrl(response.url);
  const document = await Document.create({
    title: decodeURIComponent(path.basename(new URL(response.url).pathname)) || response.url,
    sourceUrl: response.url,
    sourceId,
    storagePath,
    mimeType: response.contentType,
    origin: 'crawl',
    documentType: classifyUrl(response.url),
    department,
    status: 'published',
    verificationStatus: 'unverified',
    contentHash: hash,
    pageCount: extracted.pages,
    preview: extracted.text.slice(0, 4000),
    tables: extracted.tables.slice(0, 5),
    sizeBytes: response.body.length,
    ocrRecommended: extracted.ocrRecommended,
    allowAiInput,
  });
  await writeDocumentChunks(document.id, document, extracted.text, true);
  if (classifyUrl(response.url) === 'timetable' || looksLikeTimetableAsset(response.url)) {
    await upsertTimetableShell(response.url, response.url, department, extracted.entries);
  }
}

export async function ingestUpload(input: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  meta: {
    title?: string;
    department?: string;
    academicYear?: string;
    semester?: string;
    batch?: string;
    documentType?: string;
    validFrom?: string;
    validUntil?: string;
  };
  userId?: string;
}): Promise<string> {
  const env = getEnv();
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  const hash = sha256(input.buffer);
  const filename = `${Date.now()}-${hash.slice(0, 10)}${path.extname(input.originalName).toLowerCase()}`;
  const storagePath = path.join(env.UPLOAD_DIR, path.basename(filename));
  await writeFile(storagePath, input.buffer);
  const extracted = await extractBuffer(input.buffer, input.mimeType, input.originalName, env.OCR_ENABLED);
  const document = await Document.create({
    title: input.meta.title || input.originalName,
    storagePath,
    mimeType: input.mimeType,
    origin: 'upload',
    documentType: input.meta.documentType || classifyUrl(input.originalName),
    department: input.meta.department,
    academicYear: input.meta.academicYear,
    semester: input.meta.semester,
    batch: input.meta.batch,
    validFrom: parseDate(input.meta.validFrom),
    validUntil: parseDate(input.meta.validUntil),
    status: 'extracted',
    verificationStatus: 'unverified',
    contentHash: hash,
    preview: extracted.text.slice(0, 4000),
    tables: extracted.tables.slice(0, 5),
    sizeBytes: input.buffer.length,
    uploadedBy: input.userId,
    ocrRecommended: extracted.ocrRecommended,
    allowAiInput: true,
    pageCount: extracted.pages,
  });
  await writeDocumentChunks(document.id, document, extracted.text, false);
  if ((input.meta.documentType || classifyUrl(input.originalName)) === 'timetable') {
    await upsertTimetableShell(`upload://${document.id}`, `upload://${document.id}`, input.meta.department, extracted.entries, document.id);
  }
  return document.id;
}

export async function publishExtractedDocument(id: string, publish: boolean): Promise<void> {
  const document = await Document.findById(id);
  if (!document) throw new Error('Document not found');
  document.status = publish ? 'published' : 'extracted';
  await document.save();
  await DocumentChunk.updateMany({ documentId: document._id }, { published: publish });
}

export async function archiveDocument(id: string): Promise<void> {
  await Document.findByIdAndUpdate(id, { status: 'archived' });
  await DocumentChunk.updateMany({ documentId: id }, { published: false });
  await Timetable.updateMany({ documentId: id }, { verificationStatus: 'rejected' });
}

async function writeDocumentChunks(
  documentId: string,
  document: { title: string; sourceUrl?: string; department?: string; documentType?: string; academicYear?: string; semester?: string; allowAiInput?: boolean; verificationStatus?: string },
  text: string,
  published: boolean,
): Promise<void> {
  await DocumentChunk.deleteMany({ documentId });
  const chunks = chunkText(text).slice(0, 60).map((chunk) => ({
    documentId,
    sourceUrl: document.sourceUrl,
    title: document.title,
    text: chunk.text,
    heading: chunk.heading,
    pageNumber: chunk.pageNumber,
    chunkIndex: chunk.index,
    contentHash: sha256(`${documentId}:${chunk.index}:${chunk.text}`),
    metadata: {
      department: document.department,
      academicYear: document.academicYear,
      semester: document.semester,
      documentType: document.documentType,
    },
    verificationStatus: document.verificationStatus ?? 'unverified',
    published,
    allowAiInput: document.allowAiInput !== false,
    retrievedAt: new Date(),
  }));
  if (chunks.length) {
    await DocumentChunk.insertMany(chunks);
    if (published) await embedChunks(chunks.map((chunk) => chunk.contentHash), { documentId });
  }
}

async function upsertTimetableShell(
  assetUrl: string,
  sourceUrl: string,
  department: string | undefined,
  entries: ParsedEntry[],
  documentId?: string,
): Promise<void> {
  const meta = parseTimetableLocation(assetUrl);
  const existing = await Timetable.findOne({ sourceUrl, imageUrl: assetUrl });
  const timetable = existing ?? new Timetable({ sourceUrl, imageUrl: assetUrl });
  timetable.title = decodeURIComponent(path.basename(assetUrl.split('?')[0] ?? assetUrl));
  timetable.documentId = documentId;
  timetable.department = meta.department || department;
  timetable.academicYear = meta.academicYear;
  timetable.year = meta.year;
  timetable.semester = meta.semester;
  timetable.section = meta.section;
  timetable.imageUrl = /\.(jpe?g|png|webp)$/i.test(assetUrl) ? assetUrl : timetable.imageUrl;
  timetable.confidence = entries.length ? Math.max(...entries.map((entry) => entry.confidence)) : meta.confidence;
  if (timetable.verificationStatus !== 'verified') timetable.verificationStatus = 'unverified';
  await timetable.save();
  if (entries.length && timetable.verificationStatus !== 'verified') {
    await TimetableEntry.deleteMany({ timetableId: timetable._id });
    await TimetableEntry.insertMany(
      entries.map((entry) => ({ ...entry, timetableId: timetable._id, sourceUrl })),
    );
  }
}

async function extractBuffer(buffer: Buffer, mimeType: string, name: string, ocrEnabled: boolean) {
  const lower = `${mimeType} ${name}`.toLowerCase();
  if (lower.includes('pdf')) {
    const pdf = await extractPdf(buffer);
    let text = pdf.text;
    if (ocrEnabled && pdf.ocrRecommended) text = `${text}\n${await ocrImage(buffer)}`.trim();
    return { text, tables: [], entries: timetableEntriesFromText(text), pages: pdf.pages.length, ocrRecommended: pdf.ocrRecommended };
  }
  if (lower.includes('word') || lower.endsWith('.docx')) {
    const docx = await extractDocx(buffer);
    return { text: docx.text, tables: docx.tables, entries: timetableEntriesFromText(docx.text), pages: 1, ocrRecommended: false };
  }
  if (lower.includes('sheet') || lower.includes('csv') || lower.endsWith('.xlsx') || lower.endsWith('.csv')) {
    const sheet = extractSpreadsheet(buffer);
    return { text: sheet.text, tables: sheet.tables, entries: sheet.entries, pages: 1, ocrRecommended: false };
  }
  if (ocrEnabled && (lower.includes('image') || /\.(png|jpe?g|webp)$/.test(lower))) {
    const text = await ocrImage(buffer);
    return { text, tables: [], entries: timetableEntriesFromText(text), pages: 1, ocrRecommended: false };
  }
  const text = buffer.toString('utf8');
  return { text, tables: [], entries: timetableEntriesFromText(text), pages: 1, ocrRecommended: false };
}

async function embedChunks(hashes: string[], scope: { pageId?: unknown; documentId?: unknown }): Promise<void> {
  const provider = getProvider();
  if (!provider.isConfigured() || !hashes.length) return;
  const chunks = await DocumentChunk.find({ ...scope, contentHash: { $in: hashes } }).limit(80);
  for (let index = 0; index < chunks.length; index += 8) {
    const batch = chunks.slice(index, index + 8);
    try {
      const vectors = await provider.embed(
        batch.map((chunk) => chunk.text.slice(0, 6000)),
        'RETRIEVAL_DOCUMENT',
      );
      await Promise.all(
        batch.map((chunk, offset) => {
          const vector = vectors[offset];
          if (!vector?.length) return Promise.resolve();
          return DocumentChunk.updateOne({ _id: chunk._id }, { embedding: vector, embeddingModel: getEnv().GEMINI_EMBEDDING_MODEL });
        }),
      );
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : 'embed failed' }, 'embedding batch skipped');
    }
  }
}

function isUsefulUrl(url: string): boolean {
  if (/\/cdn-cgi\/|email-protection|javascript:|mailto:/.test(url)) return false;
  return !/\.(css|js|woff2?|ttf|mp4|zip|svg|png|jpe?g|gif|webp|ico)(\?|$)/i.test(url);
}

function looksLikeBinaryDocument(url: string): boolean {
  return /\.(pdf|docx|xlsx|csv)(\?|$)/i.test(url);
}

function takeNextUrl(seeds: string[], discovered: string[], htmlBudget: boolean, documentBudget: boolean): string | undefined {
  const take = (queue: string[], predicate: (url: string) => boolean) => {
    const index = queue.findIndex(predicate);
    if (index < 0) return undefined;
    return queue.splice(index, 1)[0];
  };
  if (htmlBudget) {
    const htmlSeed = take(seeds, (url) => !looksLikeBinaryDocument(url));
    if (htmlSeed) return htmlSeed;
  }
  if (documentBudget) {
    const documentSeed = take(seeds, looksLikeBinaryDocument);
    if (documentSeed) return documentSeed;
  }
  if (htmlBudget) {
    const htmlFound = take(discovered, (url) => !looksLikeBinaryDocument(url));
    if (htmlFound) return htmlFound;
  }
  if (documentBudget) return take(discovered, looksLikeBinaryDocument);
  return undefined;
}

function isDocument(contentType: string, url: string): boolean {
  return /pdf|word|sheet|csv|image/.test(contentType) || /\.(pdf|docx|xlsx|csv|png|jpe?g|webp)(\?|$)/i.test(url);
}

function looksLikeHtml(buffer: Buffer): boolean {
  const start = buffer.subarray(0, 200).toString('utf8').toLowerCase();
  return start.includes('<html') || start.includes('<!doctype html');
}

function hostIsAllowed(url: string, allowedHosts: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function priority(url: string): number {
  const value = url.toLowerCase();
  if (/\.pdf(\?|$)/.test(value) && /calender|calendar/.test(value)) return 0;
  if (/\.pdf(\?|$)/.test(value) && /exam|notice|circular|notific|fee/.test(value)) return 1;
  if (/\.pdf(\?|$)/.test(value) && /timetable|placement/.test(value)) return 2;
  if (value.includes('timetable')) return 3;
  if (value.includes('faculty')) return 4;
  if (/\.pdf(\?|$)/.test(value)) return 8;
  return 5;
}

function topicFor(url: string, pageUrl: string): string {
  const value = `${url} ${pageUrl}`.toLowerCase();
  if (value.includes('lab')) return 'laboratory';
  if (value.includes('event') || value.includes('gallery')) return 'event';
  if (value.includes('hostel') || value.includes('library')) return 'facility';
  if (value.includes('timetable')) return 'timetable';
  if (/cse|ece|eee|civil|mech|department/.test(value)) return 'department';
  return 'general';
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time);
}

async function log(jobId: string, line: string): Promise<void> {
  await IngestionJob.updateOne({ _id: jobId }, { $push: { logs: { $each: [line], $slice: -80 } } });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
