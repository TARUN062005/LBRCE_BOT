import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Express } from 'express';

const SYSTEM_MONGOD = [
  process.env.MONGOMS_SYSTEM_BINARY,
  'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
  'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe',
].find((candidate): candidate is string => typeof candidate === 'string' && existsSync(candidate));

describe('API integration', () => {
  let mongo: MongoMemoryServer;
  let app: Express;

  beforeAll(async () => {
    if (SYSTEM_MONGOD) process.env.MONGOMS_SYSTEM_BINARY = SYSTEM_MONGOD;
    mongo = await MongoMemoryServer.create();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_SECRET = 'test-secret-test-secret';
    process.env.ADMIN_EMAIL = 'admin@test.local';
    process.env.ADMIN_PASSWORD = 'test-password-123';
    process.env.ADMIN_NAME = 'Test Admin';
    process.env.GEMINI_API_KEY = '';
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    process.env.RUN_WORKER = 'false';
    const env = await import('../config/env.js');
    env.resetEnvForTests();
    const db = await import('../config/db.js');
    await db.connectDb();
    const seed = await import('../scripts/ensure-seed.js');
    await seed.ensureSeed();
    const application = await import('../app.js');
    app = application.createApp();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  it('rejects unauthenticated admin access and accepts a valid login', async () => {
    await request(app).get('/api/admin/dashboard').expect(401);
    const login = await request(app).post('/api/admin/auth/login').send({
      email: 'admin@test.local',
      password: 'test-password-123',
    });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    const dashboard = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${login.body.token}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.sources[0].baseUrl).toBe('https://www.lbrce.ac.in/');
  });

  it('validates chat input and refuses an unsupported college fact', async () => {
    await request(app).post('/api/chat').send({ message: '', sessionId: 'session-123456' }).expect(400);
    const response = await request(app).post('/api/chat').send({
      message: 'Who is the head of the CSE department?',
      sessionId: 'session-123456',
    });
    expect(response.status).toBe(200);
    expect(response.body.blocks[0].type).toBe('insufficient_evidence');
    expect(JSON.stringify(response.body)).not.toMatch(/Dr\.|Professor [A-Z]/);
  });

  it('cites a published synthetic chunk without calling Gemini', async () => {
    const { DocumentChunk } = await import('../models/index.js');
    await DocumentChunk.create({
      title: 'SYNTHETIC FIXTURE page',
      text: 'SYNTHETIC FIXTURE. The indexed example sentence says the library wing is labeled Example Wing.',
      sourceUrl: 'https://www.lbrce.ac.in/synthetic-fixture',
      published: true,
      verificationStatus: 'unverified',
      allowAiInput: false,
      metadata: { documentType: 'other' },
    });
    const response = await request(app).post('/api/chat').send({
      message: 'What does the synthetic fixture say about the library wing?',
      sessionId: 'session-123456',
    });
    expect(response.status).toBe(200);
    const text = JSON.stringify(response.body);
    expect(text).toMatch(/Example Wing/);
    expect(text).toMatch(/lbrce\.ac\.in\/synthetic-fixture/);
    expect(text).not.toMatch(/generated summary was produced/i);
  });

  it('stores an upload as unpublished until an admin publishes it', async () => {
    const login = await request(app).post('/api/admin/auth/login').send({
      email: 'admin@test.local',
      password: 'test-password-123',
    });
    const token = login.body.token as string;
    const uploaded = await request(app)
      .post('/api/admin/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('meta', JSON.stringify({ title: 'SYNTHETIC FIXTURE notice', documentType: 'notice' }))
      .attach('file', Buffer.from('SYNTHETIC FIXTURE notice body. Not a real circular.'), 'notice.txt');
    expect(uploaded.status).toBe(201);
    const hidden = await request(app).get('/api/documents');
    expect(JSON.stringify(hidden.body)).not.toMatch(/SYNTHETIC FIXTURE notice/);
    await request(app)
      .post(`/api/admin/documents/${uploaded.body.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const visible = await request(app).get('/api/documents?documentType=notice');
    expect(JSON.stringify(visible.body)).toMatch(/SYNTHETIC FIXTURE notice/);
  });

  it('rejects a disguised executable upload', async () => {
    const login = await request(app).post('/api/admin/auth/login').send({
      email: 'admin@test.local',
      password: 'test-password-123',
    });
    const rejected = await request(app)
      .post('/api/admin/documents/upload')
      .set('Authorization', `Bearer ${login.body.token}`)
      .attach('file', Buffer.from('MZ not a pdf'), 'notice.pdf');
    expect(rejected.status).toBe(400);
  });
});
