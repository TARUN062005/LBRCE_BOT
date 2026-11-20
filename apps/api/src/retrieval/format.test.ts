import { describe, expect, it } from 'vitest';
import { requestedShape, shapeInstruction } from './format.js';

describe('answer shape', () => {
  it('follows an explicit table, list, step, image, or pdf request', () => {
    expect(requestedShape('Compare CSE and ECE in table format.')).toBe('table');
    expect(requestedShape('Give me the answer in bullet points.')).toBe('bullets');
    expect(requestedShape('Explain the admission process step by step.')).toBe('steps');
    expect(requestedShape('Show me the faculty photographs.')).toBe('images');
    expect(requestedShape('Give me the academic calendar as a PDF.')).toBe('pdf');
  });

  it('keeps an ordinary explanation in prose', () => {
    expect(requestedShape('Explain the CSE department.')).toBe('prose');
    expect(shapeInstruction('Explain the CSE department.')).toMatch(/Do not use a table/);
    expect(shapeInstruction('Give me the academic calendar as a PDF.')).toMatch(/Do not claim a PDF was created/);
  });
});
