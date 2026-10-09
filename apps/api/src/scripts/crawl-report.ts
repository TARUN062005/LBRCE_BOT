import { connectDb, disconnectDb } from '../config/db.js';
import { CollegeImage, CrawledPage, Document, IngestionJob, Timetable } from '../models/index.js';
import { ensureSeed } from './ensure-seed.js';
import { enqueueCrawl, processNextJob } from '../services/ingestion.service.js';

await connectDb();
await ensureSeed();
const jobId = await enqueueCrawl();
await processNextJob();
const job = await IngestionJob.findById(jobId).lean();
const pages = await CrawledPage.find().select('url title statusCode').lean();
const documents = await Document.find().select('title sourceUrl documentType status').lean();
const images = await CollegeImage.countDocuments();
const timetables = await Timetable.find().select('title department academicYear semester section sourceUrl imageUrl').limit(30).lean();
console.log(
  JSON.stringify(
    {
      job: { status: job?.status, error: job?.error, stats: job?.stats, logs: job?.logs },
      pages: pages.map((page) => ({ url: page.url, title: page.title })),
      documents: documents.map((document) => ({ title: document.title, url: document.sourceUrl, type: document.documentType })),
      imageCount: images,
      timetableCount: await Timetable.countDocuments(),
      timetableSample: timetables,
    },
    null,
    2,
  ),
);
await disconnectDb();
