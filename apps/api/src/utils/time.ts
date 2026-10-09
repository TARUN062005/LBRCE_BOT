const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export function weekdayInKolkata(now = new Date()): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' })
    .format(now)
    .toLowerCase();
}

export function isoDateInKolkata(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}

export function normalizeWeekday(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  const hit = WEEKDAYS.find((day) => day.startsWith(text.slice(0, 3)) && text.length >= 3);
  if (hit && (text === hit || text === hit.slice(0, 3))) return hit;
  return WEEKDAYS.find((day) => text.includes(day));
}

export function isWithinRange(day: string, from?: string, until?: string): boolean {
  if (from && day < from.slice(0, 10)) return false;
  if (until && day > until.slice(0, 10)) return false;
  return true;
}

export { WEEKDAYS };
