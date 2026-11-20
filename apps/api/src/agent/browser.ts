import { chromium, type Browser, type Page } from 'playwright';
import type { ResolveHost } from '../security/ssrf.js';
import { assertCollegeHttps, sanitizeUntrusted } from './policy.js';

export interface BrowseResult {
  url: string;
  text: string;
  screenshot: boolean;
  screenshotPng?: Buffer;
  error?: string;
}

export interface BrowseOptions {
  resolve?: ResolveHost;
  executablePath?: string;
  prepare?: (page: Page) => Promise<void>;
  launch?: () => Promise<Browser>;
  capture?: (page: Page) => Promise<Buffer>;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Opens one approved HTTPS page after the caller has already failed to download it.
 * A screenshot is reported only when the captured bytes are a real PNG.
 */
export async function browseOfficialPage(rawUrl: string, options: BrowseOptions = {}): Promise<BrowseResult> {
  let url: URL;
  try {
    url = await assertCollegeHttps(rawUrl, options.resolve);
  } catch (error) {
    return { url: rawUrl, text: '', screenshot: false, error: error instanceof Error ? error.message : 'Blocked URL' };
  }
  let browser: Browser | undefined;
  try {
    browser = options.launch ? await options.launch() : await chromium.launch({ headless: true, executablePath: options.executablePath });
    const page = await browser.newPage();
    await options.prepare?.(page);
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    try {
      await assertCollegeHttps(page.url(), options.resolve);
    } catch (error) {
      return {
        url: page.url(),
        text: '',
        screenshot: false,
        error: error instanceof Error ? error.message : 'Redirect left the official college site',
      };
    }
    await scrollPage(page);
    const text = sanitizeUntrusted(await visibleText(page, options.resolve));
    const png = options.capture ? await options.capture(page) : await page.screenshot({ type: 'png', fullPage: true });
    if (!isPng(png)) {
      return { url: page.url(), text, screenshot: false, error: 'The screenshot was not captured.' };
    }
    return { url: page.url(), text: text.slice(0, 6000), screenshot: true, screenshotPng: png };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser automation failed';
    const missing = /cannot find package|executable doesn't exist|failed to launch|enoent|chromium is not installed/i.test(message);
    return {
      url: url.toString(),
      text: '',
      screenshot: false,
      error: missing ? 'Chromium is not installed, so the page was not opened.' : message.includes('screenshot') ? 'The screenshot was not captured.' : 'The official page could not be opened in the browser.',
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function scrollPage(page: Page): Promise<void> {
  await page.evaluate(`async () => {
    const height = Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0);
    const step = window.innerHeight || 800;
    for (let top = 0; top < height; top += step) {
      window.scrollTo(0, top);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
  }`);
}

async function visibleText(page: Page, resolve?: ResolveHost): Promise<string> {
  const parts = [await page.locator('body').innerText({ timeout: 8_000 }).catch(() => '')];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      await assertCollegeHttps(frame.url(), resolve);
      parts.push(await frame.locator('body').innerText({ timeout: 3_000 }));
    } catch {
      continue;
    }
  }
  return parts.filter(Boolean).join('\n');
}

function isPng(value: Buffer | undefined): value is Buffer {
  return Boolean(value && value.length > 100 && value.subarray(0, 8).equals(PNG));
}
