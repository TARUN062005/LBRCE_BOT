import { describe, expect, it } from 'vitest';
import { assertPublicUrl, hostAllowed, isPrivateAddress } from './ssrf.js';

describe('SSRF guards', () => {
  it('blocks private and link-local addresses', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('192.168.1.9')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('172.16.0.4')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('::1')).toBe(true);
  });

  it('allows only the configured college domain', () => {
    expect(hostAllowed('www.lbrce.ac.in', ['lbrce.ac.in'])).toBe(true);
    expect(hostAllowed('cse.lbrce.ac.in', ['lbrce.ac.in'])).toBe(true);
    expect(hostAllowed('lbrce.ac.in.evil.com', ['lbrce.ac.in'])).toBe(false);
    expect(hostAllowed('example.com', ['lbrce.ac.in'])).toBe(false);
  });

  it('rejects non-http schemes, credentials, and private resolutions', async () => {
    await expect(assertPublicUrl('file:///etc/passwd', ['lbrce.ac.in'], async () => [])).rejects.toThrow(/HTTP/);
    await expect(
      assertPublicUrl('https://user:pass@www.lbrce.ac.in/a', ['lbrce.ac.in'], async () => [{ address: '1.2.3.4' }]),
    ).rejects.toThrow(/credentials/);
    await expect(
      assertPublicUrl('http://127.0.0.1/admin', ['lbrce.ac.in'], async () => [{ address: '127.0.0.1' }]),
    ).rejects.toThrow(/allowlist|Private/);
    await expect(
      assertPublicUrl('https://www.lbrce.ac.in/timetables.php', ['lbrce.ac.in'], async () => [
        { address: '127.0.0.1' },
      ]),
    ).rejects.toThrow(/private/i);
    const url = await assertPublicUrl('https://www.lbrce.ac.in/cse/csetimetables.php', ['lbrce.ac.in'], async () => [
      { address: '203.0.113.10' },
    ]);
    expect(url.hostname).toBe('www.lbrce.ac.in');
  });
});
