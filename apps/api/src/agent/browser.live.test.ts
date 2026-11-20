import { describe, expect, it } from 'vitest';
import { browseOfficialPage } from './browser.js';

const resolve = async () => [{ address: '1.1.1.1' }];
const pageUrl = 'https://www.lbrce.ac.in/academic_pages/aycalender.php';

describe('official browser', () => {
  it('opens an approved page, reads the embedded viewer, and keeps the PNG', async () => {
    const result = await browseOfficialPage(pageUrl, {
      resolve,
      prepare: async (page) => {
        await page.route('**/*', (route) => {
          const url = route.request().url();
          if (url.includes('viewer.html')) {
            return route.fulfill({ contentType: 'text/html', body: '<html><body><p>Embedded timetable Algorithms period 1</p></body></html>' });
          }
          return route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body style="height:2400px"><h1>Academic calendar</h1><p>This academic calendar explains the CSE semester for 2026-27.</p><iframe src="https://www.lbrce.ac.in/viewer.html"></iframe></body></html>',
          });
        });
      },
    });
    expect(result.screenshot).toBe(true);
    expect(result.screenshotPng?.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(result.text).toMatch(/academic calendar/i);
    expect(result.text).toMatch(/Algorithms/);
    expect(result.url).toContain('lbrce.ac.in');
  }, 40000);

  it('discards a redirect that leaves the college domain', async () => {
    const result = await browseOfficialPage(pageUrl, {
      resolve,
      prepare: async (page) => {
        await page.route('**/*', (route) => {
          const url = route.request().url();
          if (url.startsWith('https://www.lbrce.ac.in')) {
            return route.fulfill({ status: 302, headers: { location: 'https://example.com/out' } });
          }
          return route.fulfill({ contentType: 'text/html', body: '<html><body>outside</body></html>' });
        });
      },
    });
    expect(result.screenshot).toBe(false);
    expect(result.screenshotPng).toBeUndefined();
    expect(result.text).toBe('');
    expect(result.error).toMatch(/allowlist|official/i);
  }, 40000);

  it('reports a missing Chromium executable without claiming a screenshot', async () => {
    const result = await browseOfficialPage(pageUrl, { resolve, executablePath: 'C:\\lbrce-missing-chromium\\chrome.exe' });
    expect(result.screenshot).toBe(false);
    expect(result.screenshotPng).toBeUndefined();
    expect(result.error).toMatch(/not installed|could not be opened/i);
  }, 20000);

  it('does not claim a screenshot when capture fails', async () => {
    const result = await browseOfficialPage(pageUrl, {
      resolve,
      prepare: async (page) => {
        await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body><p>Academic calendar 2026-27</p></body></html>' }));
      },
      capture: async () => {
        throw new Error('screenshot failed');
      },
    });
    expect(result.screenshot).toBe(false);
    expect(result.screenshotPng).toBeUndefined();
    expect(result.error).toMatch(/screenshot/i);
  }, 40000);
});
