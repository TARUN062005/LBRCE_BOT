import { describe, expect, it } from 'vitest';
import { dependsOnEarlierTurn, isComparative } from './conversation.js';

describe('conversation research', () => {
  it('keeps a direct college question on the normal path', () => {
    expect(dependsOnEarlierTurn('Who is the current principal?')).toBe(false);
    expect(isComparative('Who is the current principal?')).toBe(false);
  });

  it('treats a pronoun follow-up as conversation context', () => {
    expect(dependsOnEarlierTurn('What about its faculty?')).toBe(true);
    expect(dependsOnEarlierTurn('CSE')).toBe(false);
  });

  it('sends a comparison to multi-source research', () => {
    expect(isComparative('Compare the CSE and ECE departments at LBRCE based on faculty and placements.')).toBe(true);
  });
});