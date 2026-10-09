import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { getEnv } from './config/env.js';
import { ensureSeed } from './scripts/ensure-seed.js';
import { startWorker } from './services/ingestion.service.js';
import { logger } from './utils/logger.js';

const env = getEnv();

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'LBRCE API listening');
});


let stopWorker = () => {};

void connectDb()
  .then(() => ensureSeed())
  .then(() => {
    if (env.RUN_WORKER) stopWorker = startWorker();
  })
  .catch((error) => {
    logger.error({ err: error }, 'startup failed');
    process.exit(1);
  });

async function shutdown() {
  stopWorker();
  server.close();
  const mongoose = await import('mongoose');
  await mongoose.default.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
