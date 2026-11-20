import { describe, expect, it } from 'vitest';
import { matchingImages } from './images.js';

describe('college image search', () => {
  const records = [
    {
      title: 'CSE timetable',
      topic: 'timetable',
      department: 'CSE',
      academicYear: '2026-27',
      pageNumber: 2,
      ocrText: 'Monday Algorithms',
      description: 'Official class timetable scan',
      sourceUrl: 'https://www.lbrce.ac.in/cse/timetable.png',
    },
    {
      title: 'Campus lawn',
      topic: 'campus',
      description: 'Front lawn photograph',
      sourceUrl: 'https://www.lbrce.ac.in/images/lawn.jpg',
    },
    {
      title: 'CSE roster',
      topic: 'timetable',
      context: 'student list private',
      sourceUrl: 'https://www.lbrce.ac.in/cse/students.png',
    },
  ];

  it('finds a timetable image from its OCR text and keeps its source metadata', () => {
    const found = matchingImages(records, 'CSE Monday timetable');
    expect(found).toHaveLength(1);
    expect(found[0]?.department).toBe('CSE');
    expect(found[0]?.academicYear).toBe('2026-27');
    expect(found[0]?.pageNumber).toBe(2);
  });

  it('does not return a private student image or an unrelated campus photo', () => {
    const found = matchingImages(records, 'CSE timetable');
    expect(found.map((item) => item.title)).toEqual(['CSE timetable']);
  });
});
