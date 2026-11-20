import * as cheerio from 'cheerio';
import type { IntentType } from '../retrieval/intent.js';
import { decodeCfEmail } from '../retrieval/grounding.js';
import { fetchPublic } from './college-sources/fetch.js';

export interface OfficialTarget {
  url: string;
  title: string;
  mustMatch: RegExp;
}

export interface OfficialPage {
  url: string;
  title: string;
  text: string;
}

const SITE = 'https://www.lbrce.ac.in';

function page(path: string, title: string, mustMatch: RegExp): OfficialTarget {
  return { url: `${SITE}${path}`, title, mustMatch };
}

/** Official pages to open when the index does not already answer. An empty list means there is no dedicated page. */
export function officialTargetsFor(intent: IntentType): OfficialTarget[] {
  switch (intent) {
    case 'examination':
      return [
        page('/examsection_pages/examtables.php', 'Examination timetables', /\bexam/i),
        page('/examsection_pages/examnotific.php', 'Examination notifications', /\bexam/i),
      ];
    case 'attendance':
      return [page('/academic_pages/acadregulations.php', 'Academic regulations', /attendance/i)];
    case 'scholarship':
      return [
        page('/admission_pages/admissions.php', 'Admissions', /scholarship/i),
        page('/academic_pages/acadregulations.php', 'Academic regulations', /scholarship/i),
      ];
    case 'hostel':
      return [page('/studentcorner_pages/hostels.php', 'Hostels', /hostel/i)];
    case 'administration':
      return [page('/administration_pages/principal.php', 'Principal', /principal/i)];
    case 'contact':
      return [page('/quicklinks_pages/contact.php', 'Contact', /mylavaram|phone|e-?mail|contact/i)];
    case 'fee':
      return [
        page('/admission_pages/feestructure.php', 'Fee structure', /\bfee/i),
        page('/feestructure.php', 'Fee structure', /\bfee/i),
      ];
    case 'placement':
      return [
        page('/placements/placementcontact.php', 'Placements team', /placement|training and placement|industrial relations/i),
        page('/placements/stat2526.php', 'Placement statistics', /placement|recruiter|company/i),
        page('/placements/index.php', 'Placements', /placement/i),
      ];
    case 'admission':
      return [page('/admission_pages/admissions.php', 'Admissions', /admission|eapcet|icet|pgecet/i)];
    case 'department':
      return [page('/admission_pages/courses.php', 'Courses', /engineering|department|programme|program/i)];
    case 'notice':
      return [page('/examsection_pages/examnotific.php', 'Examination notifications', /notice|notification|exam|circular/i)];
    case 'calendar':
      return [page('/academic_pages/aycalender.php', 'Academic calendars', /cal[ae]nd[ae]r/i)];
    default:
      return [];
  }
}

export async function loadOfficialTopicPages(intent: IntentType, signal?: AbortSignal): Promise<OfficialPage[]> {
  const targets = officialTargetsFor(intent);
  const pages: OfficialPage[] = [];
  for (const target of targets) {
    if (signal?.aborted || pages.length >= 2) break;
    try {
      const response = await fetchPublic(target.url, ['lbrce.ac.in']);
      const text = htmlText(response.body.toString('utf8'));
      if (text.length < 80 || !target.mustMatch.test(text)) continue;
      pages.push({ url: response.url || target.url, title: target.title, text: text.slice(0, 6000) });
    } catch {
      continue;
    }
  }
  return pages;
}

function htmlText(html: string): string {
  const $ = cheerio.load(html);
  $('[data-cfemail]').each((_, element) => {
    const email = decodeCfEmail($(element).attr('data-cfemail') ?? '');
    if (email) $(element).text(email);
  });
  $('script, style, noscript, svg, iframe, header, nav, footer').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}
