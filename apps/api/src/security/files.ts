import path from 'node:path';

const EXTENSIONS = new Map<string, string>([
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.txt', 'text/plain'],
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.csv', 'text/csv'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

export function safeFilename(original: string): string {
  const base = path.basename(original).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const ext = path.extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length) || 'upload';
  return `${Date.now()}-${stem}${ext}`;
}

export function detectUpload(buffer: Buffer, originalName: string, ocrEnabled: boolean): { mime: string; ext: string } | null {
  const ext = path.extname(originalName).toLowerCase();
  const mime = EXTENSIONS.get(ext);
  if (!mime) return null;
  if ((ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') && !ocrEnabled) return null;
  if (buffer.length < 4) return null;
  if (hasNullBytes(buffer) && !['.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    return null;
  }

  if (ext === '.pdf') return buffer.subarray(0, 5).toString('latin1') === '%PDF-' ? { mime, ext } : null;
  if (ext === '.png') return buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? { mime, ext } : null;
  if (ext === '.jpg' || ext === '.jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 ? { mime, ext } : null;
  if (ext === '.webp') {
    return buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP'
      ? { mime, ext }
      : null;
  }
  if (ext === '.docx' || ext === '.xlsx') {
    return buffer[0] === 0x50 && buffer[1] === 0x4b ? { mime, ext } : null;
  }
  if (ext === '.txt' || ext === '.csv' || ext === '.html' || ext === '.htm') return { mime, ext };
  return null;
}

function hasNullBytes(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1000));
  return sample.includes(0);
}
