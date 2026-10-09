import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import { describe, expect, it } from 'vitest';

describe('rate limiting', () => {
  it('returns 429 after the configured limit', async () => {
    const app = express();
    app.use(rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: true, legacyHeaders: false }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    await request(app).get('/ping').expect(200);
    await request(app).get('/ping').expect(200);
    const blocked = await request(app).get('/ping');
    expect(blocked.status).toBe(429);
  });
});
