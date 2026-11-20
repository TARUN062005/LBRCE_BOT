import type { QueryEntities } from './intent.js';

const FOLLOW_UP = /\b(it|its|their|that|those|this|them|there|above|previous|same|also)\b|\bwhat about\b|\bhow about\b/i;
const COMPARISON = /\b(compare|comparison|versus|vs\.?|difference between)\b/i;

/** A short question that refers to the previous turn instead of naming the subject again. */
export function dependsOnEarlierTurn(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 180) return false;
  return FOLLOW_UP.test(text);
}

/** A question that needs more than one official source before it can be answered. */
export function isComparative(message: string): boolean {
  return COMPARISON.test(message);
}

/** Keep department, semester, and section the user already gave when the next turn says "its" or "also". */
export function carryEntities(current: QueryEntities, previous: QueryEntities): QueryEntities {
  return {
    department: current.department ?? previous.department,
    departmentName: current.departmentName ?? previous.departmentName,
    year: current.year ?? previous.year,
    semester: current.semester ?? previous.semester,
    section: current.section ?? previous.section,
    day: current.day ?? previous.day,
    academicYear: current.academicYear ?? previous.academicYear,
  };
}
