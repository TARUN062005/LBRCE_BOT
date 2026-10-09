import { describe, expect, it } from 'vitest';
import { detectUpload, safeFilename } from './files.js';

describe('upload security', () => {
  it('strips path traversal from filenames', () => {
    const name = safeFilename('../../etc/passwd.txt');
    expect(name.includes('..')).toBe(false);
    expect(name.includes('/')).toBe(false);
    expect(name.includes('\\')).toBe(false);
    expect(name.endsWith('.txt')).toBe(true);
  });

  it('accepts a real PDF header and rejects a renamed executable', () => {
    const pdf = Buffer.from('%PDF-1.7\n%synthetic test fixture\n');
    expect(detectUpload(pdf, 'notice.pdf', false)?.mime).toBe('application/pdf');
    const exe = Buffer.from('MZ\x90\x00not a document');
    expect(detectUpload(exe, 'notice.pdf', false)).toBeNull();
    expect(detectUpload(exe, 'payload.exe', false)).toBeNull();
  });

  it('accepts plain text and blocks images unless OCR is enabled', () => {
    const text = Buffer.from('SYNTHETIC FIXTURE\nThis is not a college record.\n');
    expect(detectUpload(text, 'note.txt', false)?.ext).toBe('.txt');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    expect(detectUpload(jpeg, 'scan.jpg', false)).toBeNull();
    expect(detectUpload(jpeg, 'scan.jpg', true)?.mime).toBe('image/jpeg');
  });
});
