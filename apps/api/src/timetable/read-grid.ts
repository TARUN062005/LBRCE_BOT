import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TimetableEntryView } from '@lbrce/shared';
import { logger } from '../utils/logger.js';

const python = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../agent/.venv/Scripts/python.exe');
const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../agent');

/** Cells kept only when a second OCR of the same image region confirms them. */
export async function readValidatedTimetable(imageUrl: string, signal?: AbortSignal): Promise<TimetableEntryView[]> {
  if (!/^https:\/\/(?:[\w-]+\.)?lbrce\.ac\.in\//i.test(imageUrl) || signal?.aborted) return [];
  try {
    const stdout = await run(imageUrl, signal);
    const parsed = JSON.parse(stdout) as { periods?: Record<string, string | number | null>[] };
    return (parsed.periods ?? [])
      .map((period) => toEntry(period))
      .filter((entry): entry is TimetableEntryView => Boolean(entry));
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : 'timetable grid unread' }, 'timetable grid was not read');
    return [];
  }
}

function toEntry(period: Record<string, string | number | null>): TimetableEntryView | null {
  const day = String(period.dayOfWeek ?? '').toLowerCase();
  if (!day) return null;
  const subject = typeof period.subjectName === 'string' ? period.subjectName : undefined;
  const start = typeof period.startTime === 'string' ? period.startTime : undefined;
  if (!subject && !start) return null;
  return {
    dayOfWeek: day,
    periodNumber: typeof period.periodNumber === 'number' ? period.periodNumber : undefined,
    startTime: start,
    endTime: typeof period.endTime === 'string' ? period.endTime : undefined,
    subjectName: subject,
    subjectCode: typeof period.subjectCode === 'string' ? period.subjectCode : undefined,
    faculty: typeof period.faculty === 'string' ? period.faculty : undefined,
    room: typeof period.room === 'string' ? period.room : undefined,
    entryType: 'lecture',
    confidence: 0.5,
  };
}

function run(imageUrl: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-m', 'app.timetable_cli', imageUrl], { cwd: agentRoot, windowsHide: true });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timetable OCR timed out'));
    }, 90_000);
    const stop = () => {
      clearTimeout(timer);
      child.kill();
    };
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString('utf8').slice(0, 180) || `timetable OCR exited ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}
