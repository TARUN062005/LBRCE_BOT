import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import mongoose from 'mongoose';
import { getEnv } from './config/env.js';
import {
  adminDocument,
  adminDocuments,
  adminLogin,
  adminLogout,
  adminMe,
  adminTimetables,
  archive,
  dashboard,
  ingestionStatus,
  patchTimetable,
  publishDocument,
  reprocess,
  retrievalDiagnostics,
  retryJob,
  runIngestion,
  uploadDocument,
  verifyTimetable,
} from './controllers/admin.controller.js';
import {
  chatById,
  chatHistory,
  documentById,
  listDocuments,
  listTimetables,
  postChat,
  postFeedback,
  removeChat,
  search,
  searchImages,
  searchTimetables,
  sourceById,
  streamChat,
  timetableById,
} from './controllers/public.controller.js';
import {
  asyncHandler,
  chatLimiter,
  errorHandler,
  ingestLimiter,
  loginLimiter,
  requestId,
  requireAdmin,
  requireOrigin,
  uploadLimiter,
} from './middleware/common.js';
import { getProvider } from './integrations/gemini/provider.js';

export function createApp() {
  const env = getEnv();
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(requireOrigin);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });

  app.get('/api/health', (_req, res) => {
    const mongo = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    res.status(mongo === 'connected' ? 200 : 503).json({
      status: mongo === 'connected' ? 'ok' : 'degraded',
      mongo,
      gemini: getProvider().isConfigured() ? 'configured' : 'missing',
      vectorSearch: env.VECTOR_SEARCH_INDEX ? 'atlas' : 'local-cosine',
      ocr: env.OCR_ENABLED,
    });
  });

  app.post('/api/chat', chatLimiter, asyncHandler(postChat));
  app.post('/api/chat/stream', chatLimiter, asyncHandler(streamChat));
  app.get('/api/chat/history', asyncHandler(chatHistory));
  app.get('/api/chat/:id', asyncHandler(chatById));
  app.delete('/api/chat/:id', asyncHandler(removeChat));

  app.get('/api/search', asyncHandler(search));
  app.get('/api/sources/:id', asyncHandler(sourceById));
  app.get('/api/documents', asyncHandler(listDocuments));
  app.get('/api/documents/:id', asyncHandler(documentById));
  app.get('/api/timetables/search', asyncHandler(searchTimetables));
  app.get('/api/timetables', asyncHandler(listTimetables));
  app.get('/api/timetables/:id', asyncHandler(timetableById));
  app.get('/api/images/search', asyncHandler(searchImages));
  app.post('/api/feedback', asyncHandler(postFeedback));

  app.post('/api/admin/auth/login', loginLimiter, asyncHandler(adminLogin));
  app.post('/api/admin/auth/logout', asyncHandler(adminLogout));
  app.get('/api/admin/me', requireAdmin, asyncHandler(adminMe));
  app.get('/api/admin/dashboard', requireAdmin, asyncHandler(dashboard));
  app.get('/api/admin/documents', requireAdmin, asyncHandler(adminDocuments));
  app.post('/api/admin/documents/upload', requireAdmin, uploadLimiter, upload.single('file'), asyncHandler(uploadDocument));
  app.get('/api/admin/documents/:id', requireAdmin, asyncHandler(adminDocument));
  app.post('/api/admin/documents/:id/publish', requireAdmin, asyncHandler(publishDocument));
  app.post('/api/admin/documents/:id/archive', requireAdmin, asyncHandler(archive));
  app.post('/api/admin/documents/:id/reprocess', requireAdmin, asyncHandler(reprocess));
  app.post('/api/admin/ingestion/run', requireAdmin, ingestLimiter, asyncHandler(runIngestion));
  app.get('/api/admin/ingestion/status', requireAdmin, asyncHandler(ingestionStatus));
  app.post('/api/admin/ingestion/:id/retry', requireAdmin, asyncHandler(retryJob));
  app.get('/api/admin/timetables', requireAdmin, asyncHandler(adminTimetables));
  app.post('/api/admin/timetables/verify', requireAdmin, asyncHandler(verifyTimetable));
  app.patch('/api/admin/timetables/:id', requireAdmin, asyncHandler(patchTimetable));
  app.post('/api/admin/sources/refresh', requireAdmin, ingestLimiter, asyncHandler(runIngestion));
  app.get('/api/admin/retrieval', requireAdmin, asyncHandler(retrievalDiagnostics));

  app.use(errorHandler);
  return app;
}
