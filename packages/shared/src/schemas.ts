import { z } from 'zod';

export const verificationStatusSchema = z.enum(['verified', 'unverified', 'rejected', 'unknown']);

export const citationSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  pageNumber: z.number().int().positive().optional(),
  section: z.string().optional(),
  publishedAt: z.string().optional(),
  effectiveFrom: z.string().optional(),
  effectiveUntil: z.string().optional(),
  retrievedAt: z.string().optional(),
  verificationStatus: verificationStatusSchema,
  sourceType: z.enum(['webpage', 'document', 'timetable', 'image', 'structured']),
});

export type Citation = z.infer<typeof citationSchema>;

export const timetableEntryViewSchema = z.object({
  dayOfWeek: z.string(),
  periodNumber: z.number().int().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  subjectCode: z.string().optional(),
  subjectName: z.string().optional(),
  faculty: z.string().optional(),
  room: z.string().optional(),
  entryType: z.enum(['lecture', 'lab', 'break', 'free', 'other']),
  confidence: z.number().min(0).max(1),
});

export type TimetableEntryView = z.infer<typeof timetableEntryViewSchema>;

export const galleryImageSchema = z.object({
  id: z.string(),
  url: z.string(),
  pageUrl: z.string().optional(),
  title: z.string().optional(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  topic: z.string().optional(),
});

export const answerBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    markdown: z.string(),
    citations: z.array(citationSchema),
  }),
  z.object({
    type: z.literal('table'),
    title: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    sortable: z.boolean().optional(),
    citations: z.array(citationSchema),
  }),
  z.object({
    type: z.literal('timetable'),
    title: z.string(),
    view: z.enum(['day', 'week']),
    academicYear: z.string().optional(),
    regulation: z.string().optional(),
    department: z.string().optional(),
    degree: z.string().optional(),
    year: z.number().int().optional(),
    semester: z.number().int().optional(),
    section: z.string().optional(),
    batch: z.string().optional(),
    effectiveFrom: z.string().optional(),
    effectiveUntil: z.string().optional(),
    day: z.string().optional(),
    verificationStatus: z.enum(['verified', 'unverified', 'conflict']),
    note: z.string().optional(),
    entries: z.array(timetableEntryViewSchema),
    imageUrl: z.string().optional(),
    citations: z.array(citationSchema),
  }),
  z.object({
    type: z.literal('image_gallery'),
    title: z.string().optional(),
    images: z.array(galleryImageSchema),
    citations: z.array(citationSchema),
  }),
  z.object({
    type: z.literal('document_summary'),
    title: z.string(),
    markdown: z.string(),
    documentUrl: z.string().optional(),
    citations: z.array(citationSchema),
  }),
  z.object({
    type: z.literal('source_list'),
    title: z.string().optional(),
    sources: z.array(citationSchema),
  }),
  z.object({
    type: z.literal('clarification'),
    question: z.string(),
    options: z.array(z.string()),
  }),
  z.object({
    type: z.literal('insufficient_evidence'),
    message: z.string(),
    suggestions: z.array(z.string()),
  }),
]);

export type AnswerBlock = z.infer<typeof answerBlockSchema>;

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().optional(),
  sessionId: z.string().trim().min(8).max(80),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatResponseSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
  blocks: z.array(answerBlockSchema).min(1),
  relatedQuestions: z.array(z.string()),
});

export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const feedbackRequestSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  rating: z.enum(['up', 'down']),
  comment: z.string().trim().max(1000).optional(),
});

export const loginRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  q: z.string().trim().max(200).optional(),
});

export const documentMetaSchema = z.object({
  title: z.string().trim().max(300).optional(),
  department: z.string().trim().max(80).optional(),
  academicYear: z.string().trim().max(32).optional(),
  semester: z.string().trim().max(32).optional(),
  batch: z.string().trim().max(40).optional(),
  documentType: z
    .enum([
      'notice',
      'timetable',
      'circular',
      'calendar',
      'fee',
      'syllabus',
      'regulation',
      'placement',
      'faculty',
      'other',
    ])
    .optional(),
  validFrom: z.string().trim().optional(),
  validUntil: z.string().trim().optional(),
});

export const timetableEntryInputSchema = z.object({
  dayOfWeek: z.string().trim().min(1).max(20),
  periodNumber: z.number().int().min(1).max(16).optional(),
  startTime: z.string().trim().max(10).optional(),
  endTime: z.string().trim().max(10).optional(),
  subjectCode: z.string().trim().max(40).optional(),
  subjectName: z.string().trim().max(200).optional(),
  faculty: z.string().trim().max(200).optional(),
  room: z.string().trim().max(80).optional(),
  entryType: z.enum(['lecture', 'lab', 'break', 'free', 'other']).optional(),
});

export const timetablePatchSchema = z.object({
  academicYear: z.string().trim().max(32).optional(),
  regulation: z.string().trim().max(40).optional(),
  department: z.string().trim().max(80).optional(),
  degree: z.string().trim().max(80).optional(),
  year: z.number().int().min(1).max(6).optional(),
  semester: z.number().int().min(1).max(12).optional(),
  section: z.string().trim().max(12).optional(),
  batch: z.string().trim().max(40).optional(),
  effectiveFrom: z.string().trim().optional(),
  effectiveUntil: z.string().trim().optional(),
  entries: z.array(timetableEntryInputSchema).max(400).optional(),
});

export const timetableSearchQuerySchema = z.object({
  department: z.string().trim().max(80).optional(),
  academicYear: z.string().trim().max(32).optional(),
  year: z.coerce.number().int().min(1).max(6).optional(),
  semester: z.coerce.number().int().min(1).max(12).optional(),
  section: z.string().trim().max(12).optional(),
  day: z.string().trim().max(20).optional(),
  q: z.string().trim().max(300).optional(),
});

export const generatedNarrativeSchema = z.object({
  markdown: z.string().max(8000),
  citationIds: z.array(z.string()).max(12),
  relatedQuestions: z.array(z.string().max(200)).max(4),
  confidence: z.enum(['verified', 'inferred', 'insufficient']),
});

export type GeneratedNarrative = z.infer<typeof generatedNarrativeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
