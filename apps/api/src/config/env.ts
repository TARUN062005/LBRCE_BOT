import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/lbrce_ai'),
  JWT_SECRET: z.string().min(16).default('dev-only-change-this-secret'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),
  GEMINI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  VECTOR_SEARCH_INDEX: z.string().optional().default(''),
  ADMIN_EMAIL: z.string().email().default('admin@lbrce.local'),
  ADMIN_PASSWORD: z.string().optional().default(''),
  ADMIN_NAME: z.string().default('LBRCE Administrator'),
  CRAWL_MAX_PAGES: z.coerce.number().int().positive().default(40),
  CRAWL_MAX_DOCUMENTS: z.coerce.number().int().positive().default(20),
  CRAWL_DELAY_MS: z.coerce.number().int().nonnegative().default(1500),
  CRAWL_ALLOWED_HOSTS: z.string().default('lbrce.ac.in'),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(15),
  OCR_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
  RUN_WORKER: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof schema> & {
  allowedHosts: string[];
  corsOrigins: string[];
};

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.parse(process.env);
  if (parsed.NODE_ENV === 'production' && parsed.JWT_SECRET === 'dev-only-change-this-secret') {
    throw new Error('JWT_SECRET must be set in production');
  }
  if (parsed.NODE_ENV === 'production' && !parsed.ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD must be set in production');
  }
  cached = {
    ...parsed,
    allowedHosts: parsed.CRAWL_ALLOWED_HOSTS.split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    corsOrigins: parsed.CORS_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
  return cached;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const env = getEnv();
  if (env.corsOrigins.includes(origin)) return true;
  return env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1):517\d$/.test(origin);
}

export function resetEnvForTests(): void {
  cached = undefined;
  geminiKeyCache = undefined;
}

let geminiKeyCache: { file: string; mtimeMs: number; value: string } | undefined;

/** Prefer the key currently saved in `.env`, so a replaced key is used without reprinting it. */
export function readGeminiApiKey(): string {
  const files = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'apps/api/.env')];
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      if (geminiKeyCache?.file === file && geminiKeyCache.mtimeMs === stat.mtimeMs) return geminiKeyCache.value;
      const text = fs.readFileSync(file, 'utf8');
      const match = text.match(/^GEMINI_API_KEY\s*=\s*(.*)$/m);
      const value = (match?.[1] ?? '').trim().replace(/^['"]|['"]$/g, '');
      if (!value) continue;
      geminiKeyCache = { file, mtimeMs: stat.mtimeMs, value };
      return value;
    } catch {
      continue;
    }
  }
  return process.env.GEMINI_API_KEY?.trim() ?? '';
}
