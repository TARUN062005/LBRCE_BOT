import bcrypt from 'bcryptjs';
import { OFFICIAL_SEED_PATHS, OFFICIAL_SITE_URL } from '@lbrce/shared';
import { getEnv } from '../config/env.js';
import { CollegeSource, User } from '../models/index.js';

export async function ensureSeed(): Promise<void> {
  const env = getEnv();
  await CollegeSource.updateOne(
    { baseUrl: OFFICIAL_SITE_URL },
    {
      $set: {
        allowedHosts: env.allowedHosts,
        crawlDelayMs: env.CRAWL_DELAY_MS,
        maxPages: env.CRAWL_MAX_PAGES,
        maxDocuments: env.CRAWL_MAX_DOCUMENTS,
      },
      $setOnInsert: {
        name: 'LBRCE official website',
        baseUrl: OFFICIAL_SITE_URL,
        seedPaths: [...OFFICIAL_SEED_PATHS],
        enabled: true,
        allowAiInput: true,
        health: 'unknown',
      },
    },
    { upsert: true },
  );
  if (!env.ADMIN_PASSWORD) return;
  const existing = await User.findOne({ email: env.ADMIN_EMAIL.toLowerCase() });
  if (existing) return;
  await User.create({
    email: env.ADMIN_EMAIL.toLowerCase(),
    passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, 12),
    name: env.ADMIN_NAME,
    role: 'admin',
  });
}
