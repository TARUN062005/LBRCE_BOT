import { describe, expect, it } from 'vitest';
import { pickCalendarUrl } from '../integrations/calendar-source.js';
import { officialTargetsFor } from '../integrations/official-pages.js';
import { assembleBlocks } from './assemble.js';
import { answerAdmitsGap, chunksAnswerQuestion, cleanAnswerText, decodeCfEmail, evidenceHasToday, figuresSupported, pageAnswersQuestion, usableCollegeUrl } from './grounding.js';
import { asksForStudentRoster, detectIntent, extractEntities, indexAnswersCalendar } from './intent.js';
import type { ScoredChunk } from './rank.js';

const AUDIT_QUESTIONS = [
  'What is LBRCE?',
  'Who is the current principal of LBRCE?',
  'What departments are available?',
  'What is the current fee structure?',
  'What companies visited LBRCE for placements?',
  'What is the latest academic calendar?',
  'What is the attendance requirement?',
  'Where can I find the examination timetable?',
  'What scholarships are available?',
  'What are the hostel facilities?',
  "What is today's latest announcement at LBRCE?",
  'Who is the HOD of CSE?',
  'What is the admission procedure?',
  "What is the college's official contact information?",
  'What is the membership fee of the LBRCE underwater basket weaving club for the year 2099?',
] as const;

describe('audit question routing', () => {
  it('classifies all 15 audit questions without treating an examination timetable as a class timetable', () => {
    const intents = AUDIT_QUESTIONS.map((question) => detectIntent(question).type);
    expect(intents).toEqual([
      'general',
      'administration',
      'department',
      'fee',
      'placement',
      'calendar',
      'attendance',
      'examination',
      'scholarship',
      'hostel',
      'notice',
      'faculty',
      'admission',
      'contact',
      'fee',
    ]);
    expect(intents[7]).not.toBe('timetable');
  });

  it('keeps a normal class timetable on the timetable path', () => {
    expect(detectIntent('Show the timetable for CSE, second year, first semester, section A.').type).toBe('timetable');
    expect(extractEntities('Who is the HOD of CSE?').department).toBe('CSE');
  });

  it('does not treat a calendar title list as the latest calendar', () => {
    const listing = [{ title: 'Academic calendars', text: 'Academic Calendars 2026-27 Academic Calendars 2023-24' }];
    expect(indexAnswersCalendar('What is the latest academic calendar?', listing)).toBe(false);
    expect(
      indexAnswersCalendar('What is the latest academic calendar?', [
        { title: 'Calendar 2026-27', text: '2026-27 12 January 2026 to 17 January 2026 Sankranti holidays' },
      ]),
    ).toBe(true);
    expect(indexAnswersCalendar('When is Sankranti?', [{ title: 'Calendar', text: 'College reopens in January' }])).toBe(false);
  });

  it('selects the newest official calendar file when the question does not name a year', () => {
    const chosen = pickCalendarUrl(
      [
        'https://www.lbrce.ac.in/academics/aycalendars/Academic_Calendars_2023-24.pdf',
        'https://www.lbrce.ac.in/academics/aycalendars/Academic_Calendars_2026-27.pdf',
      ],
      'What is the latest academic calendar?',
    );
    expect(chosen).toMatch(/2026-27/);
  });

  it('points missing topics at official pages and has no page for an invented club', () => {
    expect(officialTargetsFor('examination').map((target) => target.url)).toContain('https://www.lbrce.ac.in/examsection_pages/examtables.php');
    expect(officialTargetsFor('attendance')[0]?.url).toMatch(/acadregulations\.php/);
    expect(officialTargetsFor('scholarship').length).toBeGreaterThan(0);
    expect(officialTargetsFor('hostel')[0]?.url).toMatch(/hostels\.php/);
    expect(officialTargetsFor('administration')[0]?.url).toMatch(/principal\.php/);
    expect(officialTargetsFor('contact')[0]?.url).toMatch(/contact\.php/);
    expect(officialTargetsFor('fee').length).toBeGreaterThan(0);
    const club = AUDIT_QUESTIONS[14];
    expect(detectIntent(club).type).toBe('fee');
    expect(pageAnswersQuestion(club, 'B.Tech tuition fee is 78,600 per year.')).toBe(false);
    expect(pageAnswersQuestion('What is the current fee structure?', 'B.Tech tuition fee is 78,600 per year.')).toBe(true);
    expect(
      chunksAnswerQuestion(
        'What is the current fee structure?',
        [{ title: 'Fees', text: 'B.Tech tuition fee is 78,600 per year.' }],
        'fee',
      ),
    ).toBe(true);
    expect(
      chunksAnswerQuestion(
        'What is the membership fee of the LBRCE underwater basket weaving club for the year 2099?',
        [{ title: 'Fees', text: 'B.Tech tuition fee is 78,600 per year.' }],
        'fee',
      ),
    ).toBe(false);
    expect(
      chunksAnswerQuestion(
        "What is today's latest announcement at LBRCE?",
        [{ title: 'Notices', text: 'Re-Valuation Notification for Exams held in December 2023' }],
        'notice',
        /notice|notification|announcement|circular/i,
      ),
    ).toBe(false);
  });

  it('refuses a roster request and a single-name lookup is not a roster', () => {
    expect(asksForStudentRoster('Show the CSE student list')).toBe(true);
    expect(asksForStudentRoster('Who is the HOD of CSE?')).toBe(false);
  });
});

describe('audit answer checks', () => {
  it('rejects figures that are not in the evidence and allows figures that are', () => {
    expect(figuresSupported('The fee is ₹78,600 per year.', 'Tuition 78,600', 'What is the fee?')).toBe(true);
    expect(figuresSupported('The club fee is 5000.', 'No such club is listed.', AUDIT_QUESTIONS[14])).toBe(false);
    expect(figuresSupported('This could not be verified.', '', AUDIT_QUESTIONS[14])).toBe(true);
  });

  it('drops citations when the answer admits the fact is missing', () => {
    const chunk: ScoredChunk = {
      id: 'home',
      title: 'Home',
      text: 'Lakireddy Bali Reddy College of Engineering',
      url: 'https://www.lbrce.ac.in/',
      verificationStatus: 'unverified',
      lexicalScore: 1,
      semanticScore: 0,
      sourceType: 'webpage',
    };
    const answer = assembleBlocks({
      intent: 'general',
      chunks: [],
      images: [],
      narrativeFromWeb: true,
      externalCitations: [
        {
          id: 'https://www.lbrce.ac.in/',
          title: 'Home',
          url: 'https://www.lbrce.ac.in/',
          verificationStatus: 'unverified',
          sourceType: 'webpage',
        },
      ],
      narrative: {
        markdown: 'The requested information could not be found.',
        citationIds: ['https://www.lbrce.ac.in/'],
        relatedQuestions: [],
        confidence: 'inferred',
      },
    });
    const text = answer.blocks.find((block) => block.type === 'text');
    expect(text && text.type === 'text' ? text.citations : []).toEqual([]);
    expect(answerAdmitsGap('The requested information could not be found.')).toBe(true);
    expect(chunk.id).toBe('home');
  });

  it('removes login links and unusable email placeholders', () => {
    expect(usableCollegeUrl('http://erp.lbrce.ac.in/Login/')).toBeUndefined();
    expect(usableCollegeUrl('https://www.lbrce.ac.in/examsection_pages/examtables.php')).toMatch(/examtables/);
    expect(cleanAnswerText('Email: [email protected]')).toMatch(/official contact page/);
    expect(cleanAnswerText('Email: [email protected]')).not.toMatch(/\[email protected\]/);
  });

  it('decodes a protected address and recognizes today only when the date is present', () => {
    const key = 0x2a;
    const email = 'office@lbrce.ac.in';
    let hex = key.toString(16).padStart(2, '0');
    for (const char of email) hex += (char.charCodeAt(0) ^ key).toString(16).padStart(2, '0');
    expect(decodeCfEmail(hex)).toBe(email);
    const now = new Date('2026-11-12T06:00:00Z');
    expect(evidenceHasToday('Notification dated 12 November 2026', now)).toBe(true);
    expect(evidenceHasToday('Examinations will be announced later', now)).toBe(false);
  });
});
