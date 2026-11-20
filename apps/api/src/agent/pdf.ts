import { fetchPublic } from '../integrations/college-sources/fetch.js';
import { extractPdf, ocrPdf } from '../ingestion/extract.js';
import { assertCollegeHttps, assessPdf, rememberDocument, sanitizeUntrusted, type EvidenceItem } from './policy.js';

export interface PdfBundle {
  url: string;
  bytes: Buffer;
  hash: string;
  text: string;
  pageCount: number;
  scanned: boolean;
  duplicate: boolean;
}

export async function downloadOfficialPdf(url: string): Promise<PdfBundle> {
  const safe = await assertCollegeHttps(url);
  const response = await fetchPublic(safe.toString(), ['lbrce.ac.in'], { maxBytes: 12 * 1024 * 1024 });
  const signature = assessPdf(response.body);
  if (!signature.ok) throw new Error(signature.reason);
  const extracted = await extractPdf(response.body);
  const pageCount = extracted.pages.length || 1;
  const limited = assessPdf(response.body, pageCount);
  if (!limited.ok) throw new Error(limited.reason);
  const text = sanitizeUntrusted(extracted.text);
  const memory = rememberDocument(limited.hash);
  return {
    url: response.url || safe.toString(),
    bytes: response.body,
    hash: limited.hash,
    text,
    pageCount,
    scanned: text.length < 80,
    duplicate: memory.duplicate,
  };
}

export async function readScannedPdf(bundle: PdfBundle, readDocument?: (bytes: Buffer) => Promise<string>): Promise<EvidenceItem> {
  const capturedAt = new Date().toISOString();
  if (!bundle.scanned && bundle.text.length >= 80) {
    return {
      sourceUrl: bundle.url,
      sourceType: 'pdf',
      extractedText: bundle.text.slice(0, 6000),
      capturedAt,
      contentHash: bundle.hash,
      verificationStatus: 'partial',
    };
  }
  const ocr = sanitizeUntrusted(await ocrPdf(bundle.bytes));
  if (ocr.length >= 80) {
    return {
      sourceUrl: bundle.url,
      sourceType: 'pdf',
      extractedText: ocr.slice(0, 6000),
      capturedAt,
      contentHash: bundle.hash,
      verificationStatus: 'partial',
    };
  }
  if (!readDocument) {
    return {
      sourceUrl: bundle.url,
      sourceType: 'pdf',
      extractedText: '',
      capturedAt,
      contentHash: bundle.hash,
      verificationStatus: 'unverified',
    };
  }
  const vision = sanitizeUntrusted(await readDocument(bundle.bytes));
  return {
    sourceUrl: bundle.url,
    sourceType: 'image',
    extractedText: vision.slice(0, 6000),
    capturedAt,
    contentHash: bundle.hash,
    pageNumber: 1,
    verificationStatus: vision ? 'partial' : 'unverified',
  };
}
