import type { IntentType } from '../retrieval/intent.js';
import { officialTargetsFor } from '../integrations/official-pages.js';
import { refusesOutsideCollege } from './policy.js';

export const TOOL_NAMES = [
  'search_college_knowledge',
  'search_faculty_records',
  'search_timetable',
  'search_academic_calendar',
  'search_official_notices',
  'search_college_images',
  'search_official_website',
  'discover_official_links',
  'fetch_official_page',
  'browse_official_page',
  'download_official_pdf',
  'inspect_pdf_metadata',
  'extract_pdf_text',
  'extract_pdf_tables',
  'extract_pdf_images',
  'render_pdf_page',
  'search_pdf_pages',
  'perform_ocr',
  'analyze_document_image',
  'extract_timetable_structure',
  'extract_calendar_events',
  'extract_notice_information',
  'describe_college_image',
  'open_official_url',
  'navigate_official_page',
  'inspect_embedded_document',
  'capture_page_screenshot',
  'extract_visible_page_content',
  'verify_evidence',
  'verify_document_date',
  'detect_conflicting_sources',
  'validate_answer_claims',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface PlannedTool {
  name: ToolName;
  args: Record<string, string>;
}

const STATUS: Partial<Record<ToolName, string>> = {
  search_college_knowledge: 'Searching college records',
  search_academic_calendar: 'Opening the academic calendar',
  download_official_pdf: 'Downloading an official PDF',
  extract_pdf_text: 'Reading PDF pages',
  render_pdf_page: 'Rendering a scanned PDF page',
  analyze_document_image: 'Reading the document image',
  browse_official_page: 'Opening the official page',
  capture_page_screenshot: 'Capturing the official page',
  fetch_official_page: 'Opening an official college page',
  extract_timetable_structure: 'Analyzing the timetable image',
  verify_evidence: 'Verifying the retrieved text',
};

export function statusFor(name: ToolName): string {
  return STATUS[name] ?? 'Checking official college sources';
}

/** Deterministic, bounded plan. The model may only narrow this list, never extend it. */
export function planTools(message: string, intent: IntentType): PlannedTool[] {
  if (refusesOutsideCollege(message)) return [];
  const steps: PlannedTool[] = [{ name: 'search_college_knowledge', args: { query: message } }];
  if (intent === 'faculty') steps.push({ name: 'search_faculty_records', args: { query: message } });
  if (intent === 'timetable') steps.push({ name: 'search_timetable', args: { query: message } }, { name: 'extract_timetable_structure', args: { query: message } });
  if (intent === 'calendar') {
    steps.push({ name: 'search_academic_calendar', args: { query: message } }, { name: 'extract_calendar_events', args: { query: message } });
  }
  if (intent === 'notice' || intent === 'examination') steps.push({ name: 'search_official_notices', args: { query: message } });
  if (intent === 'image') steps.push({ name: 'search_college_images', args: { query: message } }, { name: 'describe_college_image', args: { query: message } });
  const targets = officialTargetsFor(intent);
  const first = targets[0];
  if (first) steps.push({ name: 'fetch_official_page', args: { url: first.url } });
  if (intent === 'calendar' || /\.pdf\b/i.test(message)) {
    steps.push({ name: 'download_official_pdf', args: {} }, { name: 'extract_pdf_text', args: {} }, { name: 'render_pdf_page', args: {} });
  }
  steps.push({ name: 'verify_evidence', args: {} }, { name: 'validate_answer_claims', args: {} });
  const seen = new Set<string>();
  return steps.filter((step) => {
    if (seen.has(step.name)) return false;
    seen.add(step.name);
    return true;
  }).slice(0, 6);
}
