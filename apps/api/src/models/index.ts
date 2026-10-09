import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ['admin', 'operator'], default: 'admin' },
  },
  { timestamps: true },
);

const conversationSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    title: { type: String, default: 'New chat' },
  },
  { timestamps: true },
);

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
    blocks: { type: [Schema.Types.Mixed], default: [] },
    relatedQuestions: { type: [String], default: [] },
    status: { type: String, enum: ['complete', 'error'], default: 'complete' },
  },
  { timestamps: true },
);
messageSchema.index({ conversationId: 1, createdAt: 1 });

const collegeSourceSchema = new Schema(
  {
    name: { type: String, required: true },
    baseUrl: { type: String, required: true, unique: true },
    allowedHosts: { type: [String], default: ['lbrce.ac.in'] },
    seedPaths: { type: [String], default: [] },
    enabled: { type: Boolean, default: true },
    crawlDelayMs: { type: Number, default: 1500 },
    maxPages: { type: Number, default: 40 },
    maxDocuments: { type: Number, default: 20 },
    allowAiInput: { type: Boolean, default: true },
    lastCrawledAt: Date,
    lastSuccessAt: Date,
    health: { type: String, enum: ['unknown', 'healthy', 'degraded', 'failed'], default: 'unknown' },
    lastError: String,
  },
  { timestamps: true },
);

const crawledPageSchema = new Schema(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: 'CollegeSource', index: true },
    url: { type: String, required: true, unique: true },
    title: String,
    headings: { type: [String], default: [] },
    text: { type: String, default: '' },
    contentHash: { type: String, required: true },
    contentType: String,
    statusCode: Number,
    lastModified: String,
    retrievedAt: { type: Date, default: Date.now },
    publishedAt: Date,
    allowAiInput: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const documentSchema = new Schema(
  {
    title: { type: String, required: true },
    sourceUrl: String,
    sourceId: { type: Schema.Types.ObjectId, ref: 'CollegeSource' },
    storagePath: String,
    mimeType: String,
    origin: { type: String, enum: ['crawl', 'upload'], required: true },
    documentType: { type: String, default: 'other', index: true },
    department: String,
    academicYear: String,
    semester: String,
    batch: String,
    validFrom: Date,
    validUntil: Date,
    status: {
      type: String,
      enum: ['uploaded', 'extracted', 'published', 'archived', 'failed'],
      default: 'uploaded',
      index: true,
    },
    verificationStatus: { type: String, enum: ['verified', 'unverified', 'rejected'], default: 'unverified' },
    contentHash: { type: String, index: true },
    version: { type: Number, default: 1 },
    pageCount: Number,
    preview: { type: String, default: '' },
    tables: { type: [Schema.Types.Mixed], default: [] },
    error: String,
    sizeBytes: Number,
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ocrRecommended: { type: Boolean, default: false },
    allowAiInput: { type: Boolean, default: true },
  },
  { timestamps: true },
);
documentSchema.index({ contentHash: 1, sourceUrl: 1 });

const documentChunkSchema = new Schema(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', index: true },
    pageId: { type: Schema.Types.ObjectId, ref: 'CrawledPage', index: true },
    sourceUrl: String,
    title: { type: String, default: '' },
    text: { type: String, required: true },
    heading: String,
    pageNumber: Number,
    section: String,
    chunkIndex: { type: Number, default: 0 },
    contentHash: String,
    embedding: { type: [Number], select: false },
    embeddingModel: String,
    metadata: {
      department: String,
      academicYear: String,
      semester: String,
      documentType: String,
      publishedAt: Date,
    },
    verificationStatus: { type: String, enum: ['verified', 'unverified', 'rejected'], default: 'unverified' },
    published: { type: Boolean, default: false, index: true },
    allowAiInput: { type: Boolean, default: true },
    retrievedAt: Date,
  },
  { timestamps: true },
);
documentChunkSchema.index({ text: 'text', title: 'text', heading: 'text' }, { name: 'chunk_text', weights: { title: 8, heading: 4, text: 1 } });
documentChunkSchema.index({ documentId: 1, chunkIndex: 1 });

const timetableSchema = new Schema(
  {
    title: { type: String, required: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document' },
    academicYear: { type: String, index: true },
    regulation: String,
    department: { type: String, index: true },
    degree: String,
    specialization: String,
    year: Number,
    semester: Number,
    section: String,
    batch: String,
    effectiveFrom: Date,
    effectiveUntil: Date,
    verificationStatus: { type: String, enum: ['verified', 'unverified', 'rejected'], default: 'unverified', index: true },
    sourceUrl: String,
    imageUrl: String,
    confidence: { type: Number, default: 0 },
    conflictNotes: String,
  },
  { timestamps: true },
);
timetableSchema.index({ department: 1, year: 1, semester: 1, section: 1, academicYear: 1 });

const timetableEntrySchema = new Schema(
  {
    timetableId: { type: Schema.Types.ObjectId, ref: 'Timetable', required: true, index: true },
    dayOfWeek: { type: String, required: true },
    periodNumber: Number,
    startTime: String,
    endTime: String,
    subjectCode: String,
    subjectName: String,
    faculty: String,
    room: String,
    entryType: { type: String, enum: ['lecture', 'lab', 'break', 'free', 'other'], default: 'other' },
    pageNumber: Number,
    confidence: { type: Number, default: 0 },
    sourceUrl: String,
  },
  { timestamps: true },
);
timetableEntrySchema.index({ timetableId: 1, dayOfWeek: 1, periodNumber: 1 });

const facultySchema = new Schema(
  {
    name: { type: String, required: true },
    designation: String,
    department: { type: String, index: true },
    email: String,
    profileUrl: String,
    isHead: { type: Boolean, default: false },
    sourceUrl: { type: String, required: true },
    verificationStatus: { type: String, enum: ['verified', 'unverified', 'rejected'], default: 'unverified' },
  },
  { timestamps: true },
);
facultySchema.index({ sourceUrl: 1, name: 1 }, { unique: true });
facultySchema.index({ name: 'text', designation: 'text', department: 'text' });

const departmentSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    hodName: String,
    description: String,
    sourceUrl: String,
    pageUrl: String,
  },
  { timestamps: true },
);

const collegeImageSchema = new Schema(
  {
    sourceUrl: { type: String, required: true, unique: true },
    pageUrl: String,
    title: String,
    alt: String,
    caption: String,
    context: String,
    topic: { type: String, index: true },
    contentHash: String,
    host: String,
  },
  { timestamps: true },
);
collegeImageSchema.index({ title: 'text', alt: 'text', caption: 'text', context: 'text' }, { name: 'image_text' });

const ingestionJobSchema = new Schema(
  {
    type: { type: String, enum: ['crawl', 'upload', 'reprocess', 'embed', 'refresh'], required: true },
    status: { type: String, enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'], default: 'queued', index: true },
    sourceId: { type: Schema.Types.ObjectId, ref: 'CollegeSource' },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document' },
    startedAt: Date,
    finishedAt: Date,
    stats: { type: Schema.Types.Mixed, default: {} },
    error: String,
    logs: { type: [String], default: [] },
  },
  { timestamps: true },
);

const feedbackSchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    rating: { type: String, enum: ['up', 'down'], required: true },
    comment: String,
  },
  { timestamps: true },
);

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true },
);
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

function register(name: string, schema: Schema): mongoose.Model<any> {
  return (mongoose.models[name] as mongoose.Model<any> | undefined) ?? mongoose.model(name, schema);
}

export const User = register('User', userSchema);
export const Conversation = register('Conversation', conversationSchema);
export const Message = register('Message', messageSchema);
export const CollegeSource = register('CollegeSource', collegeSourceSchema);
export const CrawledPage = register('CrawledPage', crawledPageSchema);
export const Document = register('Document', documentSchema);
export const DocumentChunk = register('DocumentChunk', documentChunkSchema);
export const Timetable = register('Timetable', timetableSchema);
export const TimetableEntry = register('TimetableEntry', timetableEntrySchema);
export const Faculty = register('Faculty', facultySchema);
export const Department = register('Department', departmentSchema);
export const CollegeImage = register('CollegeImage', collegeImageSchema);
export const IngestionJob = register('IngestionJob', ingestionJobSchema);
export const Feedback = register('Feedback', feedbackSchema);
export const AuditLog = register('AuditLog', auditLogSchema);

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };
