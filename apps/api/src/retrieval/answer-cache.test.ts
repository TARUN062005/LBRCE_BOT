import { describe, expect, it } from 'vitest';
import { cachedNarrative, clearNarrativeCache, evidenceKey, storeNarrative } from './answer-cache.js';

describe('answer cache', () => {
  it('reuses a narrative only for the same question and evidence', () => {
    clearNarrativeCache();
    const key = evidenceKey([{ id: '1', text: 'CSE faculty list' }]);
    storeNarrative('Explain the CSE department.', key, 'CSE has a published faculty list.', 1_000);
    expect(cachedNarrative('Explain the CSE department.', key, 2_000)).toMatch(/faculty list/);
    expect(cachedNarrative('Explain the ECE department.', key, 2_000)).toBeUndefined();
    expect(cachedNarrative('Explain the CSE department.', evidenceKey([{ id: '1', text: 'updated' }]), 2_000)).toBeUndefined();
  });

  it('drops an unverified answer and expires old entries', () => {
    clearNarrativeCache();
    const key = evidenceKey([{ id: '1', text: 'fee' }]);
    storeNarrative('What is the fee?', key, 'This could not be verified from the official college sources.', 1_000);
    expect(cachedNarrative('What is the fee?', key, 1_000)).toBeUndefined();
    storeNarrative('What is the fee?', key, 'The fee page lists tuition.', 1_000);
    expect(cachedNarrative('What is the fee?', key, 1_000 + 3 * 60 * 1000 + 1)).toBeUndefined();
  });
});
